import { Database } from "@repo/core/Database"
import { audit, client, site } from "@repo/db"
import { createServerFn } from "@tanstack/react-start"
import { and, count, desc, eq, ilike, inArray, isNull, or } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { isPrivateHost } from "@repo/capture-contract"
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
  respond,
  siteInOrg,
} from "./server-fn"

const AUDITS_PER_PAGE = 20

const requireManager = (role: string) =>
  isManager(role)
    ? Effect.void
    : Effect.fail(
        new Forbidden({ message: "Only organization owners and admins can archive or delete." }),
      )

const parseName = (value: string) => {
  const name = value.trim()
  return name.length >= 1 && name.length <= 100
    ? Effect.succeed(name)
    : Effect.fail(new Invalid({ message: "Name must be 1 to 100 characters." }))
}

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

const IdInput = Schema.Struct({ id: Schema.String })

/** `lock` takes a row lock; it only holds inside `atomically`. */
const clientInOrg = (orgId: string, id: string, lock = false) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    if (!isUuid(id)) return yield* new NotFound({ message: "Not found" })
    const query = db
      .select()
      .from(client)
      .where(and(eq(client.id, id), eq(client.orgId, orgId)))
    const [found] = yield* lock ? query.for("update") : query
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
          .where(and(eq(client.orgId, orgId), isNull(client.archivedAt)))
          .orderBy(client.name)
        const sites = yield* db
          .select({ id: site.id, clientId: site.clientId })
          .from(site)
          .where(and(eq(site.orgId, orgId), isNull(site.archivedAt)))
        const summaries = yield* siteSummaries(
          orgId,
          sites.map((s) => s.id),
        )
        const trends = yield* trendsOf(
          orgId,
          clients.map((c) => c.id),
        )
        return clients.map((c) => {
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
            siteCount: owned.length,
            running: summary.running,
            latest: summary.latest,
            trend: trends.get(c.id) ?? [],
          }
        })
      }),
    ),
  )

const SEARCH_LIMIT = 20
const RECENT_AUDITS = 5

const SearchInput = Schema.Struct({ query: Schema.String.check(Schema.isMaxLength(100)) })

/** Escapes `\`, `%` and `_` so the text matches literally inside `ilike`. */
const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

/** The first `SEARCH_LIMIT` matches by name; `capped` says more exist. An empty query lists the first by name. `audits` are the newest few, of sites matching the query. */
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
        const clients = yield* db
          .select({ id: client.id, name: client.name })
          .from(client)
          .where(
            and(
              eq(client.orgId, orgId),
              isNull(client.archivedAt),
              text === "" ? undefined : ilike(client.name, pattern),
            ),
          )
          .orderBy(client.name)
          .limit(SEARCH_LIMIT + 1)
        const sites = yield* db
          .select({ id: site.id, name: site.name, host: site.host })
          .from(site)
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
          })
          .from(audit)
          .innerJoin(site, eq(site.id, audit.siteId))
          .where(and(eq(audit.orgId, orgId), text === "" ? undefined : ilike(site.name, pattern)))
          .orderBy(desc(audit.createdAt))
          .limit(RECENT_AUDITS)
        const details = yield* auditDetails(
          orgId,
          audits.map((a) => a.id),
        )
        const scores = yield* scoresOf(orgId, details)
        return {
          audits: audits.map((a) => ({
            id: a.id,
            createdAt: a.createdAt,
            status: a.status,
            siteName: a.siteName,
            coverage: coverageOf(details, a.id),
            score: SETTLED.some((status) => status === a.status)
              ? (scores.get(a.id) ?? null)
              : null,
          })),
          clients: clients.slice(0, SEARCH_LIMIT),
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
    respond(
      Effect.gen(function* () {
        const { organizationId: orgId } = yield* membership(context.session)
        const name = yield* parseName(data.name)
        const { db } = yield* Database
        const [created] = yield* db.insert(client).values({ orgId, name }).returning()
        return { id: created?.id ?? "" }
      }),
    ),
  )

export const archiveClient = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(IdInput))
  .handler(({ context, data }) =>
    respond(
      Effect.gen(function* () {
        const { organizationId: orgId, role } = yield* membership(context.session)
        yield* clientInOrg(orgId, data.id)
        yield* requireManager(role)
        const { db } = yield* Database
        const archivedAt = new Date()
        yield* atomically(
          Effect.gen(function* () {
            const found = yield* clientInOrg(orgId, data.id, true)
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

export const deleteClient = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(IdInput))
  .handler(({ context, data }) =>
    respond(
      Effect.gen(function* () {
        const { organizationId: orgId, role } = yield* membership(context.session)
        yield* clientInOrg(orgId, data.id)
        yield* requireManager(role)
        const { db } = yield* Database
        return yield* orArchiveInstead(
          "client",
          atomically(
            Effect.gen(function* () {
              const found = yield* clientInOrg(orgId, data.id, true)
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

export const createSite = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({ clientId: Schema.String, name: Schema.String, url: Schema.String }),
    ),
  )
  .handler(({ context, data }) =>
    respond(
      Effect.gen(function* () {
        const { organizationId: orgId } = yield* membership(context.session)
        yield* clientInOrg(orgId, data.clientId)
        const name = yield* parseName(data.name)
        const { origin, host } = yield* parseSiteUrl(data.url)
        const { db } = yield* Database
        return yield* atomically(
          Effect.gen(function* () {
            const owner = yield* clientInOrg(orgId, data.clientId, true)
            if (owner.archivedAt !== null) return yield* new NotFound({ message: "Not found" })
            const [created] = yield* db
              .insert(site)
              .values({ orgId, clientId: owner.id, name, origin, host })
              .returning()
            return { id: created?.id ?? "" }
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
    respond(
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

export const archiveSite = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(IdInput))
  .handler(({ context, data }) =>
    respond(
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

export const deleteSite = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(IdInput))
  .handler(({ context, data }) =>
    respond(
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
        const owner = yield* clientInOrg(orgId, found.clientId)
        const { db } = yield* Database
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
          .where(and(eq(audit.siteId, found.id), eq(audit.orgId, orgId)))
          .orderBy(desc(audit.createdAt))
          .limit(1)
        return {
          site: {
            id: found.id,
            name: found.name,
            origin: found.origin,
            host: found.host,
            archived: found.archivedAt !== null,
          },
          client: { id: owner.id, name: owner.name },
          canManage: isManager(role),
          audits: audits.map((a) => {
            const summary = summaries.find((row) => row.id === a.id)
            return {
              id: a.id,
              status: a.status,
              error: a.error,
              createdAt: a.createdAt,
              runs: {
                total: summary?.total ?? 0,
                finished: summary?.finished ?? 0,
                incomplete: summary?.incomplete ?? 0,
              },
              score: SETTLED.some((status) => status === a.status)
                ? (scores.get(a.id) ?? null)
                : null,
              coverage: coverageOf(summaries, a.id),
              findings:
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
