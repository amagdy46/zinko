import { Database } from "@repo/core/Database"
import { audit, client, site } from "@repo/db"
import { createServerFn } from "@tanstack/react-start"
import { and, count, desc, eq, inArray, isNull, max } from "drizzle-orm"
import { Config, Effect, Option, Schema } from "effect"
import { WorkerConfig } from "effect-cf"
import { isPrivateHost } from "@repo/capture-contract"
import { canonicalHost } from "@/lib/site-url"
import { requireSession } from "./require-session"
import {
  atomically,
  Forbidden,
  Invalid,
  isUuid,
  membership,
  NotFound,
  read,
  respond,
  siteInOrg,
} from "./server-fn"

const AUDITS_PER_PAGE = 20

/** The role is a comma-separated list, such as `member,admin`. */
const isManager = (role: string) => {
  const roles = role.split(",")
  return roles.includes("owner") || roles.includes("admin")
}

const requireManager = (role: string) =>
  isManager(role)
    ? Effect.void
    : Effect.fail(
        new Forbidden({ message: "Only organization owners and admins can archive or delete." }),
      )

/** `ALLOW_PRIVATE_SITES` is set by infra/alchemy.run.ts on local dev stages only. */
const allowPrivateSites = Effect.gen(function* () {
  const provider = yield* WorkerConfig.provider
  const value = yield* Config.option(Config.String("ALLOW_PRIVATE_SITES")).parse(provider)
  return Option.isSome(value) && value.value === "true"
}).pipe(Effect.orDie)

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
      return yield* new Invalid({ message: "Enter a full URL starting with http:// or https://." })
    if (url.username !== "" || url.password !== "")
      return yield* new Invalid({ message: "The URL must not contain a user name or password." })
    const host = canonicalHost(text)
    if (host === null) return yield* new Invalid({ message: "Enter a valid URL." })
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
        const counts = yield* db
          .select({ clientId: site.clientId, total: count() })
          .from(site)
          .where(and(eq(site.orgId, orgId), isNull(site.archivedAt)))
          .groupBy(site.clientId)
        return clients.map((c) => ({
          id: c.id,
          name: c.name,
          siteCount: counts.find((row) => row.clientId === c.id)?.total ?? 0,
        }))
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
        const stats =
          sites.length === 0
            ? []
            : yield* db
                .select({ siteId: audit.siteId, total: count(), last: max(audit.createdAt) })
                .from(audit)
                .where(
                  and(
                    eq(audit.orgId, orgId),
                    inArray(
                      audit.siteId,
                      sites.map((s) => s.id),
                    ),
                  ),
                )
                .groupBy(audit.siteId)
        return {
          client: { id: found.id, name: found.name, archived: found.archivedAt !== null },
          canManage: isManager(role),
          sites: sites.map((s) => ({
            id: s.id,
            name: s.name,
            origin: s.origin,
            auditCount: stats.find((row) => row.siteId === s.id)?.total ?? 0,
            lastAuditAt: stats.find((row) => row.siteId === s.id)?.last ?? null,
          })),
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
          audits: audits.map((a) => ({
            id: a.id,
            status: a.status,
            error: a.error,
            createdAt: a.createdAt,
          })),
          page,
          hasMore: rows.length > AUDITS_PER_PAGE,
          lastConfig: latest?.config ?? null,
        }
      }),
    ),
  )
