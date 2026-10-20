import { AuditConfig, Jobs, Storage, TEST_CLICK_IDS } from "@repo/core"
import { Database } from "@repo/core/Database"
import { audit, run, site } from "@repo/db"
import { createServerFn } from "@tanstack/react-start"
import { and, asc, eq } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"
import { isOnSite } from "@/lib/site-url"
import { requireSession } from "./require-session"
import {
  atomically,
  Invalid,
  isUuid,
  membership,
  NotFound,
  read,
  respond,
  siteInOrg,
} from "./server-fn"

const MAX_URL_LENGTH = 2048

/** Long enough for one page load; the audit page refetches every 4 minutes while it is open. */
const SCREENSHOT_URL_SECONDS = 5 * 60

const RunErrors = Schema.Array(Schema.Struct({ code: Schema.String, message: Schema.String }))
const decodeRunErrors = Schema.decodeUnknownOption(RunErrors)

/**
 * The pages as `URL` writes them, each once: `http://LOCALHOST:4400/a` and `http://localhost:4400/a`
 * are one page. Every page must be on the site.
 */
const normalizePages = (pages: ReadonlyArray<string>, siteHost: string) =>
  Effect.gen(function* () {
    const hrefs: string[] = []
    for (const page of pages) {
      if (!isOnSite(page, siteHost))
        return yield* new Invalid({ message: `${page} is not on ${siteHost}.` })
      const { href } = new URL(page)
      if (!hrefs.includes(href)) hrefs.push(href)
    }
    return hrefs
  })

/** The URL each page is captured at: the test click IDs go on the start URL only. */
const captureUrls = (pages: ReadonlyArray<string>, clickIds: boolean) =>
  Effect.forEach(pages, (page, index) => {
    const url = new URL(page)
    if (index === 0 && clickIds)
      for (const [name, value] of Object.entries(TEST_CLICK_IDS)) url.searchParams.set(name, value)
    return url.href.length <= MAX_URL_LENGTH
      ? Effect.succeed(url.href)
      : Effect.fail(new Invalid({ message: `${page} is too long.` }))
  })

/**
 * Creates an audit of a site and starts its workflow. The audit and its runs (page × scenario ×
 * viewport, in that order) are inserted together; the workflow instance is named by the audit id,
 * so the audit cannot be started twice. If the start fails, the audit is saved `failed` with the
 * reason and its id is still returned.
 */
export const startAudit = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(
    Schema.toStandardSchemaV1(Schema.Struct({ siteId: Schema.String, config: AuditConfig })),
  )
  .handler(({ context, data }) =>
    respond(
      Effect.gen(function* () {
        const { organizationId: orgId, userId } = yield* membership(context.session)
        const { db } = yield* Database
        const auditId = yield* atomically(
          Effect.gen(function* () {
            const target = yield* siteInOrg(orgId, data.siteId, true)
            if (target.archivedAt !== null)
              return yield* new Invalid({ message: "This site is archived." })
            const pages = yield* normalizePages(data.config.pages, target.host)
            const config = { ...data.config, pages }
            const urls = yield* captureUrls(pages, config.clickIds)
            const [created] = yield* db
              .insert(audit)
              .values({ orgId, siteId: target.id, createdBy: userId, config, status: "queued" })
              .returning({ id: audit.id })
            if (created === undefined) return yield* new NotFound({ message: "Not found" })
            const { scenarios, viewports } = config
            const runs = urls.flatMap((pageUrl, p) =>
              scenarios.flatMap((scenario, s) =>
                viewports.map((viewport, v) => ({
                  orgId,
                  auditId: created.id,
                  ordinal: (p * scenarios.length + s) * viewports.length + v,
                  pageUrl,
                  scenario,
                  viewport,
                  status: "pending",
                })),
              ),
            )
            yield* db.insert(run).values(runs)
            return created.id
          }),
        )
        const jobs = yield* Jobs
        yield* jobs.start("audit", { auditId }, { id: auditId }).pipe(
          Effect.flatMap((instance) =>
            db.update(audit).set({ workflowId: instance.id }).where(eq(audit.id, auditId)),
          ),
          Effect.catchTag("JobError", (error) =>
            Effect.gen(function* () {
              // the call can fail (a timeout) after the instance was created; then it runs
              const created = yield* jobs.status("audit", auditId).pipe(Effect.option)
              if (Option.isSome(created))
                return yield* db
                  .update(audit)
                  .set({ workflowId: auditId })
                  .where(eq(audit.id, auditId))
              yield* Effect.logError("Audit workflow did not start", error)
              return yield* db
                .update(audit)
                .set({
                  status: "failed",
                  error: "The audit could not be started. Try again.",
                  finishedAt: new Date(),
                })
                .where(eq(audit.id, auditId))
            }),
          ),
        )
        return { auditId }
      }),
    ),
  )

/**
 * An audit of the session's organization with its runs in order. Screenshot URLs are signed for
 * 5 minutes. Another organization's audit is a 404, like a missing one.
 */
export const getAudit = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ id: Schema.String })))
  .handler(({ context, data }) =>
    read(
      Effect.gen(function* () {
        const { organizationId: orgId } = yield* membership(context.session)
        if (!isUuid(data.id)) return yield* new NotFound({ message: "Not found" })
        const { db } = yield* Database
        const [found] = yield* db
          .select({ audit, site: { id: site.id, name: site.name, host: site.host } })
          .from(audit)
          .innerJoin(site, eq(site.id, audit.siteId))
          .where(and(eq(audit.id, data.id), eq(audit.orgId, orgId)))
          .limit(1)
        if (found === undefined) return yield* new NotFound({ message: "Not found" })
        const config = yield* Schema.decodeUnknownEffect(AuditConfig)(found.audit.config).pipe(
          Effect.orDie,
        )
        const rows = yield* db
          .select()
          .from(run)
          .where(and(eq(run.auditId, found.audit.id), eq(run.orgId, orgId)))
          .orderBy(asc(run.ordinal))
        const storage = yield* Storage
        const runs = yield* Effect.forEach(rows, (r) =>
          Effect.gen(function* () {
            const screenshotUrl =
              r.screenshotKey === null
                ? null
                : yield* storage
                    .signedUrl(r.screenshotKey, { expiresInSeconds: SCREENSHOT_URL_SECONDS })
                    .pipe(Effect.orDie)
            return {
              id: r.id,
              ordinal: r.ordinal,
              pageUrl: r.pageUrl,
              scenario: r.scenario,
              viewport: r.viewport,
              status: r.status,
              failure: r.failure,
              errors: Option.getOrElse(decodeRunErrors(r.errors), () => []),
              hitCount: r.hitCount,
              complete: r.complete,
              truncated: r.truncated,
              screenshotUrl,
              startedAt: r.startedAt,
              finishedAt: r.finishedAt,
            }
          }),
        )
        const { audit: a } = found
        return {
          audit: {
            id: a.id,
            status: a.status,
            error: a.error,
            createdAt: a.createdAt,
            startedAt: a.startedAt,
            finishedAt: a.finishedAt,
            config,
          },
          site: found.site,
          runs,
        }
      }),
    ),
  )
