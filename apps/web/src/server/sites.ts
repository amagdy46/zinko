import { Database } from "@repo/core/Database"
import { audit, site } from "@repo/db"
import { createServerFn } from "@tanstack/react-start"
import { type SQL, and, count, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { isPrivateHost } from "@repo/capture-contract"
import { startPathOf } from "@/lib/audit-labels"
import { canonicalHost } from "@/lib/site-url"
import {
  auditDetails,
  coverageOfAudit,
  scoresOf,
  SETTLED,
  attentionOf,
  siteSummaries,
} from "./site-summary"
import { defaultClientOf } from "./default-client"
import { requireSession } from "./require-session"
import {
  allowPrivateSites,
  atomically,
  Forbidden,
  Invalid,
  isManager,
  membership,
  read,
  mutation,
  siteInOrg,
} from "./server-fn"

const AUDITS_PER_PAGE = 20

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

const ARCHIVE_INSTEAD = () =>
  new Invalid({ message: "This site has audits, so it cannot be deleted. Archive it instead." })

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
const orArchiveInstead = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.catchIf(
      (error: E) => hasCode(error, FOREIGN_KEY_VIOLATION),
      () => Effect.fail(ARCHIVE_INSTEAD()),
    ),
  )

const coverageOf = (details: Effect.Success<ReturnType<typeof auditDetails>>, id: string) => {
  const found = details.find((d) => d.id === id)
  return found === undefined ? null : coverageOfAudit(found)
}

const SEARCH_LIMIT = 20
const RECENT_AUDITS = 5

const SearchInput = Schema.Struct({ query: Schema.String.check(Schema.isMaxLength(100)) })

/** Escapes `\`, `%` and `_` so the text matches literally inside `ilike`. */
const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

/** Every word of the text (the first eight) must be found in one of the columns, apostrophes ignored ("sams store" finds "Sam's store"). */
const APOSTROPHES = "'’"
const wordsIn = (columns: ReadonlyArray<SQL>, text: string) =>
  and(
    ...text
      .replace(/['’]/g, "")
      .split(/\s+/)
      .filter((word) => word !== "")
      .slice(0, 8)
      .map((word) =>
        or(
          ...columns.map(
            (column) => sql`translate(${column}, ${APOSTROPHES}, '') ilike ${likePattern(word)}`,
          ),
        ),
      ),
  )

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
        const sites = yield* db
          .select({ id: site.id, name: site.name, host: site.host })
          .from(site)
          .where(
            and(
              eq(site.orgId, orgId),
              isNull(site.archivedAt),
              text === "" ? undefined : wordsIn([sql`${site.name}`, sql`${site.host}`], text),
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
                : wordsIn([sql`${site.name}`, sql`${audit.config} -> 'pages' ->> 0`], text),
            ),
          )
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
            pages: a.pages,
            startPath: startPathOf(a.startPage),
            coverage: coverageOf(details, a.id),
            score: SETTLED.some((status) => status === a.status)
              ? (scores.get(a.id)?.score ?? null)
              : null,
          })),
          sites: sites.slice(0, SEARCH_LIMIT),
          sitesCapped: sites.length > SEARCH_LIMIT,
        }
      }),
    ),
  )

/** The archived sites, newest archive first, for the Archived view. Any member may read; restoring needs `canManage`. */
export const listArchived = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .handler(({ context }) =>
    read(
      Effect.gen(function* () {
        const { organizationId: orgId, role } = yield* membership(context.session)
        const { db } = yield* Database
        const sites = yield* db
          .select({ id: site.id, name: site.name, host: site.host, archivedAt: site.archivedAt })
          .from(site)
          .where(and(eq(site.orgId, orgId), isNotNull(site.archivedAt)))
          .orderBy(desc(site.archivedAt), site.name, site.id)
        return { canManage: isManager(role), sites }
      }),
    ),
  )

export const createSite = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ name: Schema.String, url: Schema.String })))
  .handler(({ context, data }) =>
    mutation(
      Effect.gen(function* () {
        const { organizationId: orgId } = yield* membership(context.session)
        const name = yield* parseName(data.name)
        const { origin, host } = yield* parseSiteUrl(data.url)
        const { db } = yield* Database
        return yield* atomically(
          Effect.gen(function* () {
            const owner = yield* defaultClientOf(orgId)
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
        return { id: found.id }
      }),
    ),
  )

/** Restores an archived site. Owners and admins only. */
export const unarchiveSite = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(IdInput))
  .handler(({ context, data }) =>
    mutation(
      Effect.gen(function* () {
        const { organizationId: orgId, role } = yield* membership(context.session)
        const found = yield* siteInOrg(orgId, data.id)
        yield* requireManager(role, "restore")
        const { db } = yield* Database
        yield* db
          .update(site)
          .set({ archivedAt: null })
          .where(and(eq(site.orgId, orgId), eq(site.id, found.id)))
        return { id: found.id }
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

const MAX_REPORT_FOR = 200

/**
 * Who a site's report is for, printed on its cover; empty clears it. Any member may set it, like the
 * name; published reports keep what they were published with.
 */
export const updateReportFor = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(
    Schema.toStandardSchemaV1(Schema.Struct({ id: Schema.String, reportFor: Schema.String })),
  )
  .handler(({ context, data }) =>
    mutation(
      Effect.gen(function* () {
        const { organizationId: orgId } = yield* membership(context.session)
        yield* siteInOrg(orgId, data.id)
        const text = data.reportFor.trim()
        if (text.length > MAX_REPORT_FOR)
          return yield* new Invalid({
            message: `Report for must be at most ${MAX_REPORT_FOR} characters.`,
          })
        const reportFor = text === "" ? null : text
        const { db } = yield* Database
        return yield* atomically(
          Effect.gen(function* () {
            const found = yield* siteInOrg(orgId, data.id, true)
            if (found.archivedAt !== null)
              return yield* new Invalid({ message: "This site is archived." })
            yield* db
              .update(site)
              .set({ reportFor })
              .where(and(eq(site.orgId, orgId), eq(site.id, found.id)))
            return { reportFor }
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
          atomically(
            Effect.gen(function* () {
              const found = yield* siteInOrg(orgId, data.id, true)
              if ((yield* auditCount(orgId, [found.id])) > 0) return yield* ARCHIVE_INSTEAD()
              yield* db.delete(site).where(and(eq(site.orgId, orgId), eq(site.id, found.id)))
              return { id: found.id }
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
            reportFor: found.reportFor,
            archived: found.archivedAt !== null,
          },
          hasAudits: (yield* auditCount(orgId, [found.id])) > 0,
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
          .select({ id: site.id, name: site.name, host: site.host })
          .from(site)
          .where(and(eq(site.orgId, orgId), isNull(site.archivedAt)))
          .orderBy(site.name, site.id)
        const summaries = yield* siteSummaries(
          orgId,
          sites.map((s) => s.id),
        )
        const attention = yield* attentionOf(
          orgId,
          sites.map((s) => s.id),
        )
        return sites.map((s) => ({
          id: s.id,
          name: s.name,
          host: s.host,
          running: summaries.get(s.id)?.running ?? 0,
          latest: summaries.get(s.id)?.latest ?? null,
          attention: attention.get(s.id) ?? null,
        }))
      }),
    ),
  )
