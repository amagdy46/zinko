import { MAX_URL_LENGTH } from "@repo/capture-contract"
import { type AuditConfig, Jobs, TEST_CLICK_IDS } from "@repo/core"
import { Database } from "@repo/core/Database"
import { audit, checkResult, run } from "@repo/db"
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { Effect, Option } from "effect"
import { hasCredentials, isOnSite, originHost, withoutCredentials } from "@/lib/site-url"
import { atomically, Invalid, NotFound, siteInOrg } from "./server-fn"

/** Queued or running audits one organization may have at once. Provisional. */
export const MAX_ACTIVE_AUDITS = 5
export const ACTIVE_STATUSES = ["queued", "running"] as const

/**
 * The pages as `URL` writes them, each once: `http://LOCALHOST:4400/a` and `http://localhost:4400/a`
 * are one page. Every page must be on the site.
 */
export const normalizePages = (
  pages: ReadonlyArray<string>,
  target: { host: string; origin: string },
) =>
  Effect.gen(function* () {
    const hrefs: string[] = []
    for (const page of pages) {
      if (hasCredentials(page))
        return yield* new Invalid({
          message: `${withoutCredentials(page)} is refused: URLs must not contain a username or password.`,
        })
      if (!isOnSite(page, target))
        return yield* new Invalid({ message: `${page} is not on ${originHost(target.origin)}.` })
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

/** An audit with at least one check result: the only kind a comparison can start from. */
export const evaluatedAudit = (orgId: string) =>
  sql<boolean>`exists (select 1 from ${run} join ${checkResult} on ${checkResult.runId} = ${run.id} where ${run.auditId} = ${audit.id} and ${run.orgId} = ${orgId} and ${checkResult.orgId} = ${orgId})`

/**
 * The site's latest evaluated `full` audit, the default baseline of a new audit. With `lock`
 * (inside `atomically`) a concurrent delete of that audit waits for the transaction.
 */
export const latestBaseline = (orgId: string, siteId: string, lock = false) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const query = db
      .select({ id: audit.id, createdAt: audit.createdAt })
      .from(audit)
      .where(
        and(
          eq(audit.orgId, orgId),
          eq(audit.siteId, siteId),
          eq(audit.kind, "full"),
          inArray(audit.status, ["complete", "partial"]),
          evaluatedAudit(orgId),
        ),
      )
      .orderBy(desc(audit.createdAt), desc(audit.id))
      .limit(1)
    const [found] = yield* lock ? query.for("key share") : query
    return Option.fromNullishOr(found)
  })

/**
 * The baseline a re-run of `auditId` gets: that audit when it is an evaluated `full` audit, else
 * the site's latest evaluated one. An audit that does not exist (any more) is a 404.
 */
export const rerunBaseline = (orgId: string, siteId: string, auditId: string, lock = false) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const query = db
      .select({
        id: audit.id,
        createdAt: audit.createdAt,
        valid: sql<boolean>`${audit.kind} = 'full' and ${audit.status} in ('complete', 'partial') and ${evaluatedAudit(orgId)}`,
      })
      .from(audit)
      .where(and(eq(audit.id, auditId), eq(audit.orgId, orgId), eq(audit.siteId, siteId)))
      .limit(1)
    const [found] = yield* lock ? query.for("key share") : query
    if (found === undefined) return yield* new NotFound({ message: "Not found" })
    return found.valid
      ? Option.some({ id: found.id, createdAt: found.createdAt })
      : yield* latestBaseline(orgId, siteId, lock)
  })

export interface CreateAudit {
  readonly orgId: string
  readonly userId: string
  readonly siteId: string
  readonly config: AuditConfig
  /** `new`: compared with the site's latest evaluated full audit. `rerun`: compared with that audit, and one re-run per baseline at a time. */
  readonly origin: { readonly kind: "new" } | { readonly kind: "rerun"; readonly auditId: string }
}

/**
 * The only place an audit row is inserted. One transaction: the organization's advisory lock
 * (so the cap holds across sites), the site row (archived check), the baseline revalidated, the
 * cap, the in-progress guard, then the audit and its runs (page × scenario × viewport, in that
 * order, then with `journey` one journey run per scenario × viewport, when there is a key page
 * to walk to). External work (the start-page preflight, the workflow start) stays outside.
 */
export const createAudit = (input: CreateAudit) =>
  atomically(
    Effect.gen(function* () {
      const { orgId, userId } = input
      const { db } = yield* Database
      yield* db.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`audit-create:${orgId}`}, 0))`,
      )
      const target = yield* siteInOrg(orgId, input.siteId, true)
      if (target.archivedAt !== null)
        return yield* new Invalid({ message: "This site is archived." })
      const baseline = yield* input.origin.kind === "rerun"
        ? rerunBaseline(orgId, target.id, input.origin.auditId, true)
        : latestBaseline(orgId, target.id, true)
      const baselineId = Option.match(baseline, { onNone: () => null, onSome: (b) => b.id })
      const [active] = yield* db
        .select({ total: count() })
        .from(audit)
        .where(and(eq(audit.orgId, orgId), inArray(audit.status, [...ACTIVE_STATUSES])))
      if ((active?.total ?? 0) >= MAX_ACTIVE_AUDITS)
        return yield* new Invalid({
          message: `Your organization already has ${MAX_ACTIVE_AUDITS} audits in progress. Wait for one to finish.`,
        })
      if (input.origin.kind === "rerun") {
        const [running] = yield* db
          .select({ id: audit.id })
          .from(audit)
          .where(
            and(
              eq(audit.orgId, orgId),
              eq(audit.siteId, target.id),
              inArray(audit.status, [...ACTIVE_STATUSES]),
              baselineId === null
                ? isNull(audit.baselineAuditId)
                : eq(audit.baselineAuditId, baselineId),
            ),
          )
          .limit(1)
        if (running !== undefined)
          return yield* new Invalid({
            message: "A re-run of this audit is already in progress.",
          })
      }
      const pages = yield* normalizePages(input.config.pages, target)
      const config = { ...input.config, pages }
      const urls = yield* captureUrls(pages, config.clickIds)
      const [created] = yield* db
        .insert(audit)
        .values({
          orgId,
          siteId: target.id,
          createdBy: userId,
          config,
          status: "queued",
          baselineAuditId: baselineId,
        })
        .returning({ id: audit.id })
      if (created === undefined) return yield* new NotFound({ message: "Not found" })
      const { scenarios, viewports } = config
      // a journey run captures at the start URL and walks the key pages from there
      const [startUrl] = urls
      const runPages = [
        ...urls.map((pageUrl) => ({ pageUrl, journey: false })),
        ...(config.journey === true && urls.length > 1 && startUrl !== undefined
          ? [{ pageUrl: startUrl, journey: true }]
          : []),
      ]
      const runs = runPages.flatMap(({ pageUrl, journey }, p) =>
        scenarios.flatMap((scenario, s) =>
          viewports.map((viewport, v) => ({
            orgId,
            auditId: created.id,
            ordinal: (p * scenarios.length + s) * viewports.length + v,
            pageUrl,
            journey,
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

/**
 * Starts the audit's workflow, named by the audit id so it cannot start twice. If the start
 * fails, the audit is saved `failed` with the reason; its id is still returned by the caller.
 */
export const launchAudit = (auditId: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database
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
            return yield* db.update(audit).set({ workflowId: auditId }).where(eq(audit.id, auditId))
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
  })
