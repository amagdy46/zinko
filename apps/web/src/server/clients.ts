import { Database } from "@repo/core/Database"
import { audit, client, orgSetting, site } from "@repo/db"
import { createServerFn } from "@tanstack/react-start"
import { and, count, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { isPrivateHost } from "@repo/capture-contract"
import { startPathOf } from "@/lib/audit-labels"
import { distinguishers } from "@/lib/client-label"
import { canonicalHost } from "@/lib/site-url"
import {
  auditDetails,
  clientSummary,
  coverageOfAudit,
  scoresOf,
  SETTLED,
  siteSummaries,
  trendsOf,
} from "./client-summary"
import { defaultClientOf } from "./default-client"
import { groupByClientOf } from "./org-setting-data"
import { requireSession } from "./require-session"
import {
  allowPrivateSites,
  atomically,
  Forbidden,
  Invalid,
  isManager,
  isUuid,
  membership,
  NotFound,
  read,
  mutation,
  siteInOrg,
} from "./server-fn"

const AUDITS_PER_PAGE = 20
const MAX_RESTORE_ATTEMPTS = 3

const requireManager = (role: string, action = "archive or delete") =>
  isManager(role)
    ? Effect.void
    : Effect.fail(new Forbidden({ message: `Only organization owners and admins can ${action}.` }))

const parseName = (value: string) => {
  const name = value.trim()
  return name.length >= 1 && name.length <= 100
    ? Effect.succeed(name)
    : Effect.fail(new Invalid({ message: "Name must be 1 to 100 characters." }))
}

/** Case- and whitespace-insensitive form of a name, to tell whether two clients are the same. */
const nameKey = (name: string) => name.replace(/\s+/g, " ").toLocaleLowerCase()

const parseSiteUrl = (value: string) =>
  Effect.gen(function* () {
    const text = value.trim()
    const url = URL.canParse(text) ? new URL(text) : null
    if (url === null || (url.protocol !== "http:" && url.protocol !== "https:"))
      return yield* new Invalid({ message: "Enter a valid address, such as shop.example." })
    if (url.username !== "" || url.password !== "")
      return yield* new Invalid({ message: "The URL must not contain a user name or password." })
    const host = canonicalHost(text)
    if (host === null)
      return yield* new Invalid({ message: "Enter a valid address, such as shop.example." })
    if (isPrivateHost(host) && !(yield* allowPrivateSites))
      return yield* new Invalid({
        message: "This address is private and cannot be audited. Use the site's public URL.",
      })
    return { origin: url.origin, host }
  })

const MAX_MEASURED_HOSTS = 3

/** A bare host (an optional http(s):// and trailing slash are tolerated), as `URL` writes it; null for a port, path, user name or anything else. */
const measuredHostOf = (value: string) => {
  const text = value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/$/, "")
  if (!/^[^\s/:?#@[\]]+$/.test(text)) return null
  const href = `http://${text}`
  return URL.canParse(href) ? new URL(href).hostname.replace(/\.$/, "") : null
}

/**
 * The declared measured hosts: canonical, at least two labels, no IP literal and no port, none
 * private (unless private sites are allowed), none the site's own host, each once, at most three.
 */
const parseMeasuredHosts = (values: ReadonlyArray<string>, siteHost: string) =>
  Effect.gen(function* () {
    const allowPrivate = yield* allowPrivateSites
    const hosts: string[] = []
    for (const value of values) {
      if (value.trim() === "") continue
      const host = measuredHostOf(value)
      if (host === null || host.split(".").length < 2 || /^[\d.]+$/.test(host))
        return yield* new Invalid({
          message: `${value.trim()} is not a host name. Enter a name such as checkout.shop.example, without a port, path or IP address.`,
        })
      if (isPrivateHost(host) && !allowPrivate)
        return yield* new Invalid({
          message: `${host} is a private address and cannot be audited.`,
        })
      if (host === siteHost)
        return yield* new Invalid({ message: `${host} is the site's own host.` })
      if (!hosts.includes(host)) hosts.push(host)
    }
    if (hosts.length > MAX_MEASURED_HOSTS)
      return yield* new Invalid({
        message: `A site can declare at most ${MAX_MEASURED_HOSTS} other hosts.`,
      })
    return hosts
  })

const IdInput = Schema.Struct({ id: Schema.String })

/**
 * A named client of the organization; the hidden default client is never addressable by id, so it
 * is not found. `lock` takes a row lock (`"update"` or `"share"`) and only holds
 * inside `atomically`.
 */
const clientInOrg = (orgId: string, id: string, lock: false | "update" | "share" = false) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    if (!isUuid(id)) return yield* new NotFound({ message: "Not found" })
    const query = db
      .select()
      .from(client)
      .where(and(eq(client.id, id), eq(client.orgId, orgId), eq(client.isDefault, false)))
    const [found] = yield* lock === false ? query : query.for(lock)
    if (found === undefined) return yield* new NotFound({ message: "Not found" })
    return found
  })

const auditCount = (orgId: string, siteIds: readonly string[]) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    if (siteIds.length === 0) return 0
    const [row] = yield* db
      .select({ total: count() })
      .from(audit)
      .where(and(eq(audit.orgId, orgId), inArray(audit.siteId, [...siteIds])))
    return row?.total ?? 0
  })

const ARCHIVE_INSTEAD = (what: string) =>
  new Invalid({ message: `This ${what} has audits, so it cannot be deleted. Archive it instead.` })

const FOREIGN_KEY_VIOLATION = "23503"

/** Whether a Postgres error code sits anywhere inside a query error (it is wrapped in several layers). */
const hasCode = (error: unknown, code: string, depth = 0): boolean =>
  typeof error === "object" &&
  error !== null &&
  depth < 8 &&
  (("code" in error && error.code === code) ||
    [
      ...Object.values(error),
      ...("reasons" in error && Array.isArray(error.reasons) ? error.reasons : []),
      "cause" in error ? error.cause : undefined,
    ].some((inner) => hasCode(inner, code, depth + 1)))

/** An audit created after the count made the database refuse the delete: same answer as the count. */
const orArchiveInstead = <A, E, R>(what: string, effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.catchIf(
      (error: E) => hasCode(error, FOREIGN_KEY_VIOLATION),
      () => Effect.fail(ARCHIVE_INSTEAD(what)),
    ),
  )

const coverageOf = (details: Effect.Success<ReturnType<typeof auditDetails>>, id: string) => {
  const found = details.find((d) => d.id === id)
  return found === undefined ? null : coverageOfAudit(found)
}

export const listClients = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .handler(({ context }) =>
    read(
      Effect.gen(function* () {
        const { organizationId: orgId } = yield* membership(context.session)
        const { db } = yield* Database
        const clients = yield* db
          .select()
          .from(client)
          .where(
            and(eq(client.orgId, orgId), eq(client.isDefault, false), isNull(client.archivedAt)),
          )
          .orderBy(client.name)
        const sites = yield* db
          .select({
            id: site.id,
            name: site.name,
            clientId: site.clientId,
            onDefault: client.isDefault,
          })
          .from(site)
          .innerJoin(client, eq(client.id, site.clientId))
          .where(and(eq(site.orgId, orgId), isNull(site.archivedAt)))
        const summaries = yield* siteSummaries(
          orgId,
          sites.map((s) => s.id),
        )
        const trends = yield* trendsOf(
          orgId,
          clients.map((c) => c.id),
        )
        const firstSite = (id: string) =>
          sites
            .filter((s) => s.clientId === id)
            .map((s) => s.name)
            .reduce<string | null>(
              (first, name) => (first === null || name < first ? name : first),
              null,
            )
        const labels = distinguishers(clients.map((c) => ({ ...c, firstSite: firstSite(c.id) })))
        const rows = clients.map((c) => {
          const owned = sites.filter((s) => s.clientId === c.id)
          const summary = clientSummary(
            owned.flatMap((s) => {
              const own = summaries.get(s.id)
              return own === undefined ? [] : [own]
            }),
          )
          return {
            id: c.id,
            name: c.name,
            distinguisher: labels.get(c.id) ?? null,
            siteCount: owned.length,
            running: summary.running,
            latest: summary.latest,
            trend: trends.get(c.id) ?? [],
          }
        })
        // sites on the hidden default client, so the list can point at them
        const ungroupedSites = sites.filter((s) => s.onDefault).length
        return { clients: rows, ungroupedSites }
      }),
    ),
  )

const SEARCH_LIMIT = 20
const RECENT_AUDITS = 5

const SearchInput = Schema.Struct({ query: Schema.String.check(Schema.isMaxLength(100)) })

/** Escapes `\`, `%` and `_` so the text matches literally inside `ilike`. */
const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

/** The first `SEARCH_LIMIT` matches by name; `capped` says more exist. Clients are listed only when the organization groups sites by client, and a site carries its client's name only when that client is a named one. An empty query lists the first by name. `audits` are the newest few, of sites matching the query. */
export const searchTargets = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(SearchInput))
  .handler(({ context, data }) =>
    read(
      Effect.gen(function* () {
        const { organizationId: orgId } = yield* membership(context.session)
        const { db } = yield* Database
        const text = data.query.trim()
        const pattern = likePattern(text)
        const grouping = yield* groupByClientOf(orgId)
        const clients = grouping
          ? yield* db
              .select({
                id: client.id,
                name: client.name,
                siteCount: sql<number>`(select count(*)::int from ${site} where ${site.clientId} = ${client.id} and ${site.archivedAt} is null)`,
              })
              .from(client)
              .where(
                and(
                  eq(client.orgId, orgId),
                  eq(client.isDefault, false),
                  isNull(client.archivedAt),
                  text === "" ? undefined : ilike(client.name, pattern),
                ),
              )
              .orderBy(client.name)
              .limit(SEARCH_LIMIT + 1)
          : []
        const sites = yield* db
          .select({
            id: site.id,
            name: site.name,
            host: site.host,
            clientName: sql<
              string | null
            >`case when ${client.isDefault} then null else ${client.name} end`,
          })
          .from(site)
          .innerJoin(client, eq(client.id, site.clientId))
          .where(
            and(
              eq(site.orgId, orgId),
              isNull(site.archivedAt),
              text === "" ? undefined : or(ilike(site.name, pattern), ilike(site.host, pattern)),
            ),
          )
          .orderBy(site.name)
          .limit(SEARCH_LIMIT + 1)
        const audits = yield* db
          .select({
            id: audit.id,
            createdAt: audit.createdAt,
            status: audit.status,
            siteName: site.name,
            pages: sql<number>`jsonb_array_length(${audit.config} -> 'pages')`.mapWith(Number),
            startPage: sql<string>`${audit.config} -> 'pages' ->> 0`,
          })
          .from(audit)
          .innerJoin(site, eq(site.id, audit.siteId))
          .where(
            and(
              eq(audit.orgId, orgId),
              eq(audit.kind, "full"),
              isNull(site.archivedAt),
              text === ""
                ? undefined
                : or(
                    ilike(site.name, pattern),
                    sql`${audit.config} -> 'pages' ->> 0 ilike ${pattern}`,
                  ),
            ),
          )
          .orderBy(desc(audit.createdAt))
          .limit(RECENT_AUDITS)
        const details = yield* auditDetails(
          orgId,
          audits.map((a) => a.id),
        )
        const scores = yield* scoresOf(orgId, details)
        // Labels are worked out against every live client sharing a name with a result, not only
        // the results, so a search never drops the label that tells two of them apart.
        const keys = [...new Set(clients.map((c) => nameKey(c.name.trim())))]
        const namesakes =
          keys.length === 0
            ? []
            : yield* db
                .select({
                  id: client.id,
                  name: client.name,
                  firstSite: sql<
                    string | null
                  >`(select min(${site.name} collate "C") from ${site} where ${site.clientId} = ${client.id} and ${site.archivedAt} is null)`,
                })
                .from(client)
                .where(
                  and(
                    eq(client.orgId, orgId),
                    eq(client.isDefault, false),
                    isNull(client.archivedAt),
                    inArray(
                      sql<string>`lower(regexp_replace(btrim(${client.name}), '\\s+', ' ', 'g'))`,
                      keys,
                    ),
                  ),
                )
        const labels = distinguishers(namesakes)
        return {
          audits: audits.map((a) => ({
            id: a.id,
            createdAt: a.createdAt,
            status: a.status,
            siteName: a.siteName,
            pages: a.pages,
            startPath: startPathOf(a.startPage),
            coverage: coverageOf(details, a.id),
            score: SETTLED.some((status) => status === a.status)
              ? (scores.get(a.id)?.score ?? null)
              : null,
          })),
          clients: clients.slice(0, SEARCH_LIMIT).map((c) => ({
            id: c.id,
            name: c.name,
            siteCount: c.siteCount,
            distinguisher: labels.get(c.id) ?? null,
          })),
          sites: sites.slice(0, SEARCH_LIMIT),
          clientsCapped: clients.length > SEARCH_LIMIT,
          sitesCapped: sites.length > SEARCH_LIMIT,
        }
      }),
    ),
  )

export const createClient = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ name: Schema.String })))
  .handler(({ context, data }) =>
    mutation(
      Effect.gen(function* () {
        const { organizationId: orgId } = yield* membership(context.session)
        const name = yield* parseName(data.name)
        const { db } = yield* Database
        return yield* atomically(
          Effect.gen(function* () {
            // one writer per organization at a time, so two creates cannot both pass the name check
            yield* db.execute(
              sql`select pg_advisory_xact_lock(hashtextextended(${`client-name:${orgId}`}, 0))`,
            )
            const live = yield* db
              .select({ name: client.name })
              .from(client)
              .where(
                and(
                  eq(client.orgId, orgId),
                  eq(client.isDefault, false),
                  isNull(client.archivedAt),
                ),
              )
            if (live.some((c) => nameKey(c.name) === nameKey(name)))
              return yield* new Invalid({
                message: `A client named "${name}" already exists. Use another name.`,
              })
            const [created] = yield* db.insert(client).values({ orgId, name }).returning()
            yield* db
              .insert(orgSetting)
              .values({ orgId, groupByClient: true })
              .onConflictDoNothing()
            return { id: created?.id ?? "" }
          }),
        )
      }),
    ),
  )

export const archiveClient = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(IdInput))
  .handler(({ context, data }) =>
    mutation(
      Effect.gen(function* () {
        const { organizationId: orgId, role } = yield* membership(context.session)
        yield* clientInOrg(orgId, data.id)
        yield* requireManager(role)
        const { db } = yield* Database
        yield* atomically(
          Effect.gen(function* () {
            const found = yield* clientInOrg(orgId, data.id, "update")
            // a second archive keeps the first stamp: `unarchiveClient` restores the sites that carry it
            const archivedAt = found.archivedAt ?? new Date()
            yield* db
              .update(site)
              .set({ archivedAt })
              .where(
                and(eq(site.orgId, orgId), eq(site.clientId, found.id), isNull(site.archivedAt)),
              )
            yield* db
              .update(client)
              .set({ archivedAt })
              .where(and(eq(client.orgId, orgId), eq(client.id, found.id)))
          }),
        )
      }),
    ),
  )

/**
 * Restores a client and the sites that were archived with it (`archiveClient` gives them the same
 * `archived_at`); a site archived on its own earlier stays archived. Owners and admins only.
 */
export const unarchiveClient = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(IdInput))
  .handler(({ context, data }) =>
    mutation(
      Effect.gen(function* () {
        const { organizationId: orgId, role } = yield* membership(context.session)
        yield* clientInOrg(orgId, data.id)
        yield* requireManager(role, "restore")
        const { db } = yield* Database
        yield* atomically(
          Effect.gen(function* () {
            const found = yield* clientInOrg(orgId, data.id, "update")
            if (found.archivedAt === null) return
            yield* db
              .update(site)
              .set({ archivedAt: null })
              .where(
                and(
                  eq(site.orgId, orgId),
                  eq(site.clientId, found.id),
                  eq(site.archivedAt, found.archivedAt),
                ),
              )
            yield* db
              .update(client)
              .set({ archivedAt: null })
              .where(and(eq(client.orgId, orgId), eq(client.id, found.id)))
          }),
        )
      }),
    ),
  )

/** The archived sites and named clients, newest archive first, for the Archived view. Any member may read; restoring needs `canManage`. */
export const listArchived = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .handler(({ context }) =>
    read(
      Effect.gen(function* () {
        const { organizationId: orgId, role } = yield* membership(context.session)
        const { db } = yield* Database
        const sites = yield* db
          .select({
            id: site.id,
            name: site.name,
            host: site.host,
            archivedAt: site.archivedAt,
            clientId: client.id,
            clientName: client.name,
            clientArchived: client.archivedAt,
            isDefault: client.isDefault,
          })
          .from(site)
          .innerJoin(client, eq(client.id, site.clientId))
          .where(and(eq(site.orgId, orgId), isNotNull(site.archivedAt)))
          .orderBy(desc(site.archivedAt), site.name, site.id)
        const clients = yield* db
          .select({ id: client.id, name: client.name, archivedAt: client.archivedAt })
          .from(client)
          .where(
            and(eq(client.orgId, orgId), eq(client.isDefault, false), isNotNull(client.archivedAt)),
          )
          .orderBy(desc(client.archivedAt), client.name, client.id)
        return {
          canManage: isManager(role),
          sites: sites.map((s) => ({
            id: s.id,
            name: s.name,
            host: s.host,
            archivedAt: s.archivedAt,
            client: s.isDefault
              ? null
              : { id: s.clientId, name: s.clientName, archived: s.clientArchived !== null },
          })),
          clients: clients.map((c) => ({ id: c.id, name: c.name, archivedAt: c.archivedAt })),
        }
      }),
    ),
  )

export const deleteClient = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(IdInput))
  .handler(({ context, data }) =>
    mutation(
      Effect.gen(function* () {
        const { organizationId: orgId, role } = yield* membership(context.session)
        yield* clientInOrg(orgId, data.id)
        yield* requireManager(role)
        const { db } = yield* Database
        return yield* orArchiveInstead(
          "client",
          atomically(
            Effect.gen(function* () {
              const found = yield* clientInOrg(orgId, data.id, "update")
              const sites = yield* db
                .select({ id: site.id })
                .from(site)
                .where(and(eq(site.orgId, orgId), eq(site.clientId, found.id)))
              if (
                (yield* auditCount(
                  orgId,
                  sites.map((s) => s.id),
                )) > 0
              )
                return yield* ARCHIVE_INSTEAD("client")
              yield* db.delete(site).where(and(eq(site.orgId, orgId), eq(site.clientId, found.id)))
              yield* db.delete(client).where(and(eq(client.orgId, orgId), eq(client.id, found.id)))
              return { name: found.name }
            }),
          ),
        )
      }),
    ),
  )

export const getClient = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(IdInput))
  .handler(({ context, data }) =>
    read(
      Effect.gen(function* () {
        const { organizationId: orgId, role } = yield* membership(context.session)
        const found = yield* clientInOrg(orgId, data.id)
        const { db } = yield* Database
        const sites = yield* db
          .select()
          .from(site)
          .where(and(eq(site.orgId, orgId), eq(site.clientId, found.id), isNull(site.archivedAt)))
          .orderBy(site.name)
        const summaries = yield* siteSummaries(
          orgId,
          sites.map((s) => s.id),
        )
        return {
          client: { id: found.id, name: found.name, archived: found.archivedAt !== null },
          canManage: isManager(role),
          sites: sites.map((s) => {
            return {
              id: s.id,
              name: s.name,
              origin: s.origin,
              latest: summaries.get(s.id)?.latest ?? null,
              running: summaries.get(s.id)?.running ?? 0,
              auditCount: summaries.get(s.id)?.auditCount ?? 0,
              lastAuditAt: summaries.get(s.id)?.lastAuditAt ?? null,
            }
          }),
        }
      }),
    ),
  )

/** Locks a named client for update and returns its id; an archived one is not found. */
const lockedOwner = (orgId: string, clientId: string) =>
  Effect.gen(function* () {
    const owner = yield* clientInOrg(orgId, clientId, "update")
    if (owner.archivedAt !== null) return yield* new NotFound({ message: "Not found" })
    return owner.id
  })

export const createSite = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({
        clientId: Schema.optionalKey(Schema.String),
        name: Schema.String,
        url: Schema.String,
      }),
    ),
  )
  .handler(({ context, data }) =>
    mutation(
      Effect.gen(function* () {
        const { organizationId: orgId } = yield* membership(context.session)
        const { clientId } = data
        if (clientId !== undefined) yield* clientInOrg(orgId, clientId)
        const name = yield* parseName(data.name)
        const { origin, host } = yield* parseSiteUrl(data.url)
        const { db } = yield* Database
        return yield* atomically(
          Effect.gen(function* () {
            const ownerId =
              clientId === undefined
                ? (yield* defaultClientOf(orgId)).id
                : yield* lockedOwner(orgId, clientId)
            const [created] = yield* db
              .insert(site)
              .values({ orgId, clientId: ownerId, name, origin, host })
              .returning()
            return { id: created?.id ?? "" }
          }),
        )
      }),
    ),
  )

/**
 * Moves a site to a named client, or to the hidden default client with `clientId: null`. Lock
 * order client, then site: the destination is locked `for share` (it only has to stay unarchived;
 * `archiveClient` takes `for update` on the same row), then the site `for update`.
 */
export const updateSiteClient = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({ siteId: Schema.String, clientId: Schema.NullOr(Schema.String) }),
    ),
  )
  .handler(({ context, data }) =>
    mutation(
      Effect.gen(function* () {
        const { organizationId: orgId, role } = yield* membership(context.session)
        yield* siteInOrg(orgId, data.siteId)
        if (data.clientId !== null) yield* clientInOrg(orgId, data.clientId)
        yield* requireManager(role, "move a site to another client")
        const { db } = yield* Database
        return yield* atomically(
          Effect.gen(function* () {
            const destinationId =
              data.clientId === null ? (yield* defaultClientOf(orgId)).id : data.clientId
            const [destination] = yield* db
              .select()
              .from(client)
              .where(and(eq(client.id, destinationId), eq(client.orgId, orgId)))
              .for("share")
            if (destination === undefined) return yield* new NotFound({ message: "Not found" })
            if (destination.archivedAt !== null)
              return yield* new Invalid({ message: "This client is archived." })
            const found = yield* siteInOrg(orgId, data.siteId, true)
            if (found.archivedAt !== null)
              return yield* new Invalid({ message: "This site is archived." })
            yield* db
              .update(site)
              .set({ clientId: destination.id })
              .where(and(eq(site.orgId, orgId), eq(site.id, found.id)))
            return { clientId: destination.isDefault ? null : destination.id }
          }),
        )
      }),
    ),
  )

/**
 * Changes a site's address. A site without audits may move to any address; one with audits keeps
 * its host and port (so its history still describes the same site) and may change its scheme, which
 * is the usual fix for a localhost site saved as https. Earlier audits keep the URLs they captured.
 */
export const updateSiteAddress = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ id: Schema.String, url: Schema.String })))
  .handler(({ context, data }) =>
    mutation(
      Effect.gen(function* () {
        const { organizationId: orgId } = yield* membership(context.session)
        yield* siteInOrg(orgId, data.id)
        const next = yield* parseSiteUrl(data.url)
        const { db } = yield* Database
        return yield* atomically(
          Effect.gen(function* () {
            const found = yield* siteInOrg(orgId, data.id, true)
            if (found.archivedAt !== null)
              return yield* new Invalid({ message: "This site is archived." })
            const sameServer = new URL(next.origin).host === new URL(found.origin).host
            if (!sameServer && (yield* auditCount(orgId, [found.id])) > 0)
              return yield* new Invalid({
                message:
                  "This site has audits, so its address can only change between http:// and https://. Add the new address as a new site.",
              })
            yield* db
              .update(site)
              .set({ origin: next.origin, host: next.host })
              .where(and(eq(site.orgId, orgId), eq(site.id, found.id)))
            return { origin: next.origin }
          }),
        )
      }),
    ),
  )

/**
 * Declares the other hosts that belong to a site (see `site.measured_hosts`). Owners and admins
 * only, checked here; another organization's site is a 404. Audits already started keep the list
 * they were created with.
 */
export const updateMeasuredHosts = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({
        id: Schema.String,
        hosts: Schema.Array(Schema.String.check(Schema.isMaxLength(300))).check(
          Schema.isMaxLength(10),
        ),
      }),
    ),
  )
  .handler(({ context, data }) =>
    mutation(
      Effect.gen(function* () {
        const { organizationId: orgId, role } = yield* membership(context.session)
        yield* siteInOrg(orgId, data.id)
        yield* requireManager(role, "declare a site's other hosts")
        const { db } = yield* Database
        return yield* atomically(
          Effect.gen(function* () {
            const found = yield* siteInOrg(orgId, data.id, true)
            if (found.archivedAt !== null)
              return yield* new Invalid({ message: "This site is archived." })
            const hosts = yield* parseMeasuredHosts(data.hosts, found.host)
            yield* db
              .update(site)
              .set({ measuredHosts: hosts })
              .where(and(eq(site.orgId, orgId), eq(site.id, found.id)))
            return { hosts }
          }),
        )
      }),
    ),
  )

export const archiveSite = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(IdInput))
  .handler(({ context, data }) =>
    mutation(
      Effect.gen(function* () {
        const { organizationId: orgId, role } = yield* membership(context.session)
        const found = yield* siteInOrg(orgId, data.id)
        yield* requireManager(role)
        const { db } = yield* Database
        yield* db
          .update(site)
          .set({ archivedAt: new Date() })
          .where(and(eq(site.orgId, orgId), eq(site.id, found.id)))
        return { clientId: found.clientId }
      }),
    ),
  )

/**
 * Restores an archived site. Lock order client, then site: the site's client is locked `for share`
 * (an archived client has to be restored first, which brings its sites back), then the site.
 */
export const unarchiveSite = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(IdInput))
  .handler(({ context, data }) =>
    mutation(
      Effect.gen(function* () {
        const { organizationId: orgId, role } = yield* membership(context.session)
        yield* siteInOrg(orgId, data.id)
        yield* requireManager(role, "restore")
        const { db } = yield* Database
        // Each attempt is its own transaction: the client is found by an unlocked read, locked, then
        // the site is locked; if the site moved meanwhile the attempt ends and the next one starts
        // from the current client, so the lock order stays client, then site.
        for (let attempt = 0; attempt < MAX_RESTORE_ATTEMPTS; attempt++) {
          const done = yield* atomically(
            Effect.gen(function* () {
              const current = yield* siteInOrg(orgId, data.id)
              const [owner] = yield* db
                .select()
                .from(client)
                .where(and(eq(client.id, current.clientId), eq(client.orgId, orgId)))
                .for("share")
              if (owner === undefined) return yield* new NotFound({ message: "Not found" })
              const found = yield* siteInOrg(orgId, data.id, true)
              if (found.clientId !== owner.id) return null
              if (owner.archivedAt !== null)
                return yield* new Invalid({
                  message: `The client ${owner.name} is archived. Restore the client first.`,
                })
              yield* db
                .update(site)
                .set({ archivedAt: null })
                .where(and(eq(site.orgId, orgId), eq(site.id, found.id)))
              return { clientId: found.clientId }
            }),
          )
          if (done !== null) return done
        }
        return yield* new Invalid({ message: "The site changed while it was restored. Try again." })
      }),
    ),
  )

/** Renames a site. Any member may, like changing its address; published reports keep the name they were published with. */
export const renameSite = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ id: Schema.String, name: Schema.String })))
  .handler(({ context, data }) =>
    mutation(
      Effect.gen(function* () {
        const { organizationId: orgId } = yield* membership(context.session)
        yield* siteInOrg(orgId, data.id)
        const name = yield* parseName(data.name)
        const { db } = yield* Database
        return yield* atomically(
          Effect.gen(function* () {
            const found = yield* siteInOrg(orgId, data.id, true)
            if (found.archivedAt !== null)
              return yield* new Invalid({ message: "This site is archived." })
            yield* db
              .update(site)
              .set({ name })
              .where(and(eq(site.orgId, orgId), eq(site.id, found.id)))
            return { name }
          }),
        )
      }),
    ),
  )

export const deleteSite = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(IdInput))
  .handler(({ context, data }) =>
    mutation(
      Effect.gen(function* () {
        const { organizationId: orgId, role } = yield* membership(context.session)
        yield* siteInOrg(orgId, data.id)
        yield* requireManager(role)
        const { db } = yield* Database
        return yield* orArchiveInstead(
          "site",
          atomically(
            Effect.gen(function* () {
              const found = yield* siteInOrg(orgId, data.id, true)
              if ((yield* auditCount(orgId, [found.id])) > 0) return yield* ARCHIVE_INSTEAD("site")
              yield* db.delete(site).where(and(eq(site.orgId, orgId), eq(site.id, found.id)))
              return { clientId: found.clientId }
            }),
          ),
        )
      }),
    ),
  )

export const getSite = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({ id: Schema.String, page: Schema.optionalKey(Schema.Int) }),
    ),
  )
  .handler(({ context, data }) =>
    read(
      Effect.gen(function* () {
        const { organizationId: orgId, role } = yield* membership(context.session)
        const found = yield* siteInOrg(orgId, data.id)
        const { db } = yield* Database
        const [owner] = yield* db
          .select({ id: client.id, name: client.name })
          .from(client)
          .where(
            and(
              eq(client.id, found.clientId),
              eq(client.orgId, orgId),
              eq(client.isDefault, false),
            ),
          )
        const page = Math.max(data.page ?? 0, 0)
        const rows = yield* db
          .select()
          .from(audit)
          .where(and(eq(audit.siteId, found.id), eq(audit.orgId, orgId)))
          .orderBy(desc(audit.createdAt))
          .limit(AUDITS_PER_PAGE + 1)
          .offset(page * AUDITS_PER_PAGE)
        const audits = rows.slice(0, AUDITS_PER_PAGE)
        const summaries = yield* auditDetails(
          orgId,
          audits.map((a) => a.id),
        )
        const scores = yield* scoresOf(orgId, summaries)
        const [latest] = yield* db
          .select({ config: audit.config })
          .from(audit)
          .where(and(eq(audit.siteId, found.id), eq(audit.orgId, orgId), eq(audit.kind, "full")))
          .orderBy(desc(audit.createdAt))
          .limit(1)
        return {
          site: {
            id: found.id,
            name: found.name,
            origin: found.origin,
            host: found.host,
            measuredHosts: found.measuredHosts,
            archived: found.archivedAt !== null,
          },
          hasAudits: (yield* auditCount(orgId, [found.id])) > 0,
          client: owner ?? null,
          canManage: isManager(role),
          audits: audits.map((a) => {
            const summary = summaries.find((row) => row.id === a.id)
            return {
              id: a.id,
              kind: a.kind,
              narrowRuleId: a.narrowRuleId,
              pages: summary?.pages ?? 0,
              startPath: startPathOf(summary?.startPage),
              recheckTitle: summary?.recheckTitle ?? null,
              hasBaseline: a.baselineAuditId !== null,
              status: a.status,
              error: a.error,
              createdAt: a.createdAt,
              runs: {
                total: summary?.total ?? 0,
                finished: summary?.finished ?? 0,
                incomplete: summary?.incomplete ?? 0,
              },
              // a re-check has no score: it ran a few pages for one check
              score:
                a.kind === "full" && SETTLED.some((status) => status === a.status)
                  ? (scores.get(a.id)?.score ?? null)
                  : null,
              band:
                a.kind === "full" && SETTLED.some((status) => status === a.status)
                  ? (scores.get(a.id)?.band ?? null)
                  : null,
              coverage: a.kind === "full" ? coverageOf(summaries, a.id) : null,
              findings:
                a.kind !== "full" ||
                summary === undefined ||
                summary.evaluated === 0 ||
                !SETTLED.some((status) => status === a.status)
                  ? null
                  : {
                      critical: summary.critical,
                      warning: summary.warning,
                      info: summary.info,
                      couldNotCheck: summary.couldNotCheck,
                    },
            }
          }),
          page,
          hasMore: rows.length > AUDITS_PER_PAGE,
          lastConfig: latest?.config ?? null,
        }
      }),
    ),
  )

export const listSites = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .handler(({ context }) =>
    read(
      Effect.gen(function* () {
        const { organizationId: orgId } = yield* membership(context.session)
        const { db } = yield* Database
        const sites = yield* db
          .select({
            id: site.id,
            name: site.name,
            host: site.host,
            clientId: client.id,
            clientName: client.name,
            isDefault: client.isDefault,
          })
          .from(site)
          .innerJoin(client, eq(client.id, site.clientId))
          .where(and(eq(site.orgId, orgId), isNull(site.archivedAt)))
          .orderBy(site.name, site.id)
        const summaries = yield* siteSummaries(
          orgId,
          sites.map((s) => s.id),
        )
        return sites.map((s) => ({
          id: s.id,
          name: s.name,
          host: s.host,
          client: s.isDefault ? null : { id: s.clientId, name: s.clientName },
          running: summaries.get(s.id)?.running ?? 0,
          latest: summaries.get(s.id)?.latest ?? null,
        }))
      }),
    ),
  )
