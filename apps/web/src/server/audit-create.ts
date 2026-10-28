import { MAX_URL_LENGTH } from "@repo/capture-contract"
import { type AuditConfig, Jobs, TEST_CLICK_IDS } from "@repo/core"
import { Database } from "@repo/core/Database"
import { audit, checkResult, findingTriage, reportEdit, reportFindingEdit, run } from "@repo/db"
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { Effect, Option } from "effect"
import { type CellKey, cellId, cellKeyOf } from "@/lib/compare"
import { hasCredentials, isOnSite, originHost, withoutCredentials } from "@/lib/site-url"
import { storedCells } from "./cell-key"
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
  target: { host: string; origin: string; measuredHosts?: ReadonlyArray<string> },
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

/**
 * What a new audit takes over from its baseline: the accepted risks and the report edits that say
 * something (a note, a leave out, an owner override), and the disclosure level when it is not the
 * default. "Fixed" marks and the summary are never carried: the re-run verifies the first, the
 * second describes one audit.
 */
export const carryOverOf = (orgId: string, sourceId: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const [risks] = yield* db
      .select({ total: count() })
      .from(findingTriage)
      .where(
        and(
          eq(findingTriage.auditId, sourceId),
          eq(findingTriage.orgId, orgId),
          eq(findingTriage.status, "accepted_risk"),
        ),
      )
    const [edits] = yield* db
      .select({
        notes:
          sql<number>`count(*) filter (where coalesce(${reportFindingEdit.note}, '') <> '')`.mapWith(
            Number,
          ),
        owners: sql<number>`count(*) filter (where ${reportFindingEdit.owner} is not null)`.mapWith(
          Number,
        ),
        hidden: sql<number>`count(*) filter (where ${reportFindingEdit.hidden})`.mapWith(Number),
      })
      .from(reportFindingEdit)
      .where(and(eq(reportFindingEdit.auditId, sourceId), eq(reportFindingEdit.orgId, orgId)))
    const [report] = yield* db
      .select({ detail: reportEdit.detail })
      .from(reportEdit)
      .where(and(eq(reportEdit.auditId, sourceId), eq(reportEdit.orgId, orgId)))
    return {
      acceptedRisks: risks?.total ?? 0,
      notes: edits?.notes ?? 0,
      ownerOverrides: edits?.owners ?? 0,
      leftOut: edits?.hidden ?? 0,
      detailed: report?.detail === "detailed",
    }
  })

/**
 * Copies the carry-over into an audit that has no triage or report rows yet (inside the creation
 * transaction, the only writer besides `setTriage`, `saveReportEdit` and `saveFindingEdit`). Each
 * copied triage or finding edit row records where it first came from: the source row's own origin
 * if it has one, else the source audit, with that audit's creation date.
 */
const copyCarryOver = (orgId: string, auditId: string, sourceId: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    yield* db.execute(sql`
      insert into finding_triage (audit_id, org_id, rule_id, status, reason, updated_by, updated_at, inherited_from_audit_id, inherited_from_at)
      select ${auditId}, t.org_id, t.rule_id, t.status, t.reason, t.updated_by, t.updated_at,
        coalesce(t.inherited_from_audit_id, a.id), coalesce(t.inherited_from_at, a.created_at)
      from finding_triage t join audit a on a.id = t.audit_id and a.org_id = t.org_id
      where t.audit_id = ${sourceId} and t.org_id = ${orgId} and t.status = 'accepted_risk'`)
    yield* db.execute(sql`
      insert into report_finding_edit (audit_id, org_id, rule_id, note, hidden, owner, updated_by, updated_at, inherited_from_audit_id, inherited_from_at)
      select ${auditId}, e.org_id, e.rule_id, e.note, e.hidden, e.owner, e.updated_by, e.updated_at,
        coalesce(e.inherited_from_audit_id, a.id), coalesce(e.inherited_from_at, a.created_at)
      from report_finding_edit e join audit a on a.id = e.audit_id and a.org_id = e.org_id
      where e.audit_id = ${sourceId} and e.org_id = ${orgId}
        and (coalesce(e.note, '') <> '' or e.hidden or e.owner is not null)`)
    yield* db.execute(sql`
      insert into report_edit (audit_id, org_id, summary, detail, include_changes, updated_by, updated_at)
      select ${auditId}, org_id, null, detail, include_changes, updated_by, updated_at
      from report_edit
      where audit_id = ${sourceId} and org_id = ${orgId} and (detail <> 'standard' or not include_changes)`)
  })

/** A new audit is compared with the site's latest evaluated full audit, a re-run with the audit it re-runs, a re-check with none. */
const baselineFor = (orgId: string, siteId: string, input: CreateAudit) => {
  if (input.narrow !== undefined)
    return Effect.succeed(Option.none<{ id: string; createdAt: Date }>())
  if (input.origin.kind === "rerun") return rerunBaseline(orgId, siteId, input.origin.auditId, true)
  return latestBaseline(orgId, siteId, true)
}

export interface CreateAudit {
  readonly orgId: string
  readonly userId: string
  readonly siteId: string
  readonly config: AuditConfig
  /** `new`: compared with the site's latest evaluated full audit. `rerun`: compared with that audit, and one re-run per baseline at a time. */
  readonly origin: { readonly kind: "new" } | { readonly kind: "rerun"; readonly auditId: string }
  /** A re-check: a `narrow` audit of some cells for one rule. It has no baseline and carries nothing over. */
  readonly narrow?: {
    readonly ruleId: string
    readonly targets: ReadonlyArray<CellKey>
    readonly companions: ReadonlyArray<CellKey>
  }
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
      const { narrow } = input
      const baseline = yield* baselineFor(orgId, target.id, input)
      const baselineId = Option.match(baseline, { onNone: () => null, onSome: (b) => b.id })
      const [active] = yield* db
        .select({ total: count() })
        .from(audit)
        .where(and(eq(audit.orgId, orgId), inArray(audit.status, [...ACTIVE_STATUSES])))
      if ((active?.total ?? 0) >= MAX_ACTIVE_AUDITS)
        return yield* new Invalid({
          message: `Your organization already has ${MAX_ACTIVE_AUDITS} audits in progress. Wait for one to finish.`,
        })
      if (narrow !== undefined) {
        const running = yield* db
          .select({ cells: audit.narrowCells })
          .from(audit)
          .where(
            and(
              eq(audit.orgId, orgId),
              eq(audit.siteId, target.id),
              eq(audit.kind, "narrow"),
              eq(audit.narrowRuleId, narrow.ruleId),
              inArray(audit.status, [...ACTIVE_STATUSES]),
            ),
          )
        const wanted = new Set(narrow.targets.map(cellId))
        if (running.some((r) => storedCells(r.cells).some((cell) => wanted.has(cellId(cell)))))
          return yield* new Invalid({
            message: "A re-check of this check on these pages is already in progress.",
          })
      } else if (input.origin.kind === "rerun") {
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
      // the site's declared hosts at creation: the workflow reads this copy, never the live site
      const config = { ...input.config, pages, measuredHosts: target.measuredHosts }
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
          ...(narrow === undefined
            ? {}
            : {
                kind: "narrow",
                narrowRuleId: narrow.ruleId,
                narrowCells: narrow.targets,
                narrowCompanions: narrow.companions,
              }),
        })
        .returning({ id: audit.id })
      if (created === undefined) return yield* new NotFound({ message: "Not found" })
      const { scenarios, viewports } = config
      const targetIds = new Set((narrow?.targets ?? []).map((t) => cellId(t)))
      const companionIds = new Set((narrow?.companions ?? []).map(cellId))
      const roleOf = (r: {
        pageUrl: string
        scenario: string
        viewport: string
        journey: boolean
      }) => {
        if (narrow === undefined) return "target"
        const key = cellId(cellKeyOf(r, config))
        if (targetIds.has(key)) return "target"
        return companionIds.has(key) ? "companion" : "extra"
      }
      // a journey run captures at the start URL and walks the key pages from there
      const [startUrl] = urls
      const runPages = [
        ...urls.map((pageUrl) => ({ pageUrl, journey: false })),
        ...(config.journey === true && urls.length > 1 && startUrl !== undefined
          ? [{ pageUrl: startUrl, journey: true }]
          : []),
      ]
      const planned = runPages.flatMap(({ pageUrl, journey }, p) =>
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
            role: roleOf({ pageUrl, scenario, viewport, journey }),
          })),
        ),
      )
      // after the others: one accept run per declared host that follows a link from the start URL
      const [firstViewport] = viewports
      const crossHostRuns =
        narrow === undefined &&
        config.crossHost === true &&
        startUrl !== undefined &&
        firstViewport !== undefined
          ? target.measuredHosts.map((followHost, i) => ({
              orgId,
              auditId: created.id,
              ordinal: planned.length + i,
              pageUrl: startUrl,
              journey: true,
              scenario: "accept",
              viewport: firstViewport,
              status: "pending",
              role: "target",
              followHost,
            }))
          : []
      yield* db.insert(run).values([...planned, ...crossHostRuns])
      if (baselineId !== null && narrow === undefined)
        yield* copyCarryOver(orgId, created.id, baselineId)
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
