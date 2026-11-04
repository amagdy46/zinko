import { Database } from "@repo/core/Database"
import { audit, checkResult, finding, findingTriage, run } from "@repo/db"
import { and, count, desc, eq, inArray, sql } from "drizzle-orm"
import { Effect } from "effect"
import { healthScore, type Band, type ScoreCoverage, type ScoreFinding } from "@/lib/health-score"
import { decodeSeverity } from "./findings-data"
import { liveShares } from "./report-share-data"

type Latest = {
  auditId: string
  createdAt: Date
  status: string
  coverage: "full" | "partial" | "not-evaluated"
  couldNotCheck: number
  /** Runs that ended partial or failed. */
  incompleteRuns: number
  /** The health score. Null when not evaluated. */
  score: number | null
  /** The band of that score (the worst failing finding's severity), for the bar under it. */
  band: Band | null
  /** What the score was computed from. */
  scoreCoverage: ScoreCoverage
  /** Runs in the audit the score comes from. */
  runs: number
  openFindings: { critical: number; warning: number; info: number }
}

export const SETTLED = ["complete", "partial", "failed"] as const

const runsWhere = (orgId: string) => sql`${run.auditId} = ${audit.id} and ${run.orgId} = ${orgId}`

/** Run and finding aggregates for the given audits only; callers pass the few ids they show. */
export const auditDetails = (orgId: string, auditIds: readonly string[]) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    if (auditIds.length === 0) return []
    return yield* db
      .select({
        id: audit.id,
        pages: sql<number>`jsonb_array_length(${audit.config} -> 'pages')`.mapWith(Number),
        startPage: sql<string>`${audit.config} -> 'pages' ->> 0`,
        recheckTitle: sql<
          string | null
        >`(select ${checkResult.title} from ${checkResult} join ${run} on ${run.id} = ${checkResult.runId} where ${run.auditId} = ${audit.id} and ${run.orgId} = ${orgId} and ${checkResult.orgId} = ${orgId} and ${checkResult.ruleId} = ${audit.narrowRuleId} limit 1)`,
        total: sql<number>`(select count(*) from ${run} where ${runsWhere(orgId)})`.mapWith(Number),
        finished:
          sql<number>`(select count(*) from ${run} where ${runsWhere(orgId)} and ${run.status} in ('complete', 'partial', 'failed'))`.mapWith(
            Number,
          ),
        incomplete:
          sql<number>`(select count(*) from ${run} where ${runsWhere(orgId)} and ${run.status} in ('partial', 'failed'))`.mapWith(
            Number,
          ),
        evaluated:
          sql<number>`(select count(*) from ${run} where ${runsWhere(orgId)} and exists (select 1 from ${checkResult} where ${checkResult.runId} = ${run.id} and ${checkResult.orgId} = ${orgId}))`.mapWith(
            Number,
          ),
        checks: checksIn(orgId),
        unresolved: checksIn(orgId, "inconclusive"),
        critical: openCount(orgId, "critical"),
        warning: openCount(orgId, "warning"),
        info: openCount(orgId, "info"),
        couldNotCheck:
          sql<number>`(select count(*) from ${finding} where ${finding.auditId} = ${audit.id} and ${finding.orgId} = ${orgId} and ${finding.kind} = 'inconclusive')`.mapWith(
            Number,
          ),
      })
      .from(audit)
      .where(and(eq(audit.orgId, orgId), inArray(audit.id, [...auditIds])))
  })

const checksIn = (orgId: string, status?: string) =>
  sql<number>`(select count(*) from ${checkResult} join ${run} on ${run.id} = ${checkResult.runId} where ${run.auditId} = ${audit.id} and ${run.orgId} = ${orgId} and ${checkResult.orgId} = ${orgId}${status === undefined ? sql`` : sql` and ${checkResult.status} = ${status}`})`.mapWith(
    Number,
  )

/** The numbers a score's coverage is judged from (`scoreCoverage`), for one audit. */
export const coverageOfAudit = (d: AuditDetail): ScoreCoverage => ({
  totalRuns: d.total,
  evaluatedRuns: d.evaluated,
  unfinishedRuns: d.incomplete,
  checks: d.checks,
  unresolvedChecks: d.unresolved,
  unauditedSites: 0,
})

type AuditDetail = Effect.Success<ReturnType<typeof auditDetails>>[number]

const NO_UNCERTAINTY = { checks: 0, runs: 0, rules: 0, ruleTitles: [], bannerUncertainRuns: 0 }

/**
 * The health score of each audit (a missing key: not evaluated), from the stored findings and
 * check results in two queries for all of them. Only the number is used, so the uncertainty
 * and versions that the Overview prints are left empty.
 */
export const scoresOf = (orgId: string, details: readonly AuditDetail[]) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const ids = details.filter((d) => d.evaluated > 0).map((d) => d.id)
    const scores = new Map<string, { score: number; band: Band }>()
    if (ids.length === 0) return scores
    const failing = yield* db
      .select({
        auditId: finding.auditId,
        ruleId: finding.ruleId,
        title: finding.title,
        severity: finding.severity,
        failingRuns: finding.failingRuns,
      })
      .from(finding)
      .where(and(eq(finding.orgId, orgId), inArray(finding.auditId, ids), eq(finding.kind, "fail")))
    const known = yield* db
      .select({ auditId: run.auditId, ruleId: checkResult.ruleId, n: count() })
      .from(checkResult)
      .innerJoin(run, eq(run.id, checkResult.runId))
      .where(
        and(
          eq(run.orgId, orgId),
          eq(checkResult.orgId, orgId),
          inArray(run.auditId, ids),
          inArray(checkResult.status, ["pass", "fail"]),
        ),
      )
      .groupBy(run.auditId, checkResult.ruleId)
    const knownRuns = new Map(known.map((k) => [`${k.auditId}/${k.ruleId}`, k.n]))
    const byAudit = new Map<string, ScoreFinding[]>()
    for (const f of failing) {
      const list = byAudit.get(f.auditId) ?? []
      list.push({
        ruleId: f.ruleId,
        title: f.title,
        severity: yield* decodeSeverity(f.severity).pipe(Effect.orDie),
        failingRuns: f.failingRuns,
        knownRuns: Math.max(knownRuns.get(`${f.auditId}/${f.ruleId}`) ?? 0, f.failingRuns),
        bannerUncertainRuns: 0,
      })
      byAudit.set(f.auditId, list)
    }
    for (const d of details) {
      const result = healthScore({
        findings: byAudit.get(d.id) ?? [],
        uncertainty: NO_UNCERTAINTY,
        evaluatedRuns: d.evaluated,
        totalRuns: d.total,
        versions: [],
      })
      if (result.evaluated) scores.set(d.id, { score: result.score, band: result.band })
    }
    return scores
  })

const latestOf = (
  head: { id: string; createdAt: Date; status: string },
  detail: AuditDetail,
  scored: { score: number; band: Band } | undefined,
): Latest => ({
  auditId: head.id,
  createdAt: head.createdAt,
  status: head.status,
  coverage: coverageOf(detail),
  couldNotCheck: detail.couldNotCheck,
  incompleteRuns: detail.incomplete,
  score: scored?.score ?? null,
  band: scored?.band ?? null,
  scoreCoverage: coverageOfAudit(detail),
  runs: detail.total,
  openFindings: { critical: detail.critical, warning: detail.warning, info: detail.info },
})

export type SiteSummary = {
  latest: Latest | null
  running: number
  auditCount: number
  lastAuditAt: Date | null
}

/** One summary per site: cheap rows for every audit, counts only for each site's latest settled one. */
export const siteSummaries = (orgId: string, siteIds: readonly string[]) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const summaries = new Map<string, SiteSummary>()
    if (siteIds.length === 0) return summaries
    const hasChecks = sql<boolean>`exists (select 1 from ${run} join ${checkResult} on ${checkResult.runId} = ${run.id} where ${run.auditId} = ${audit.id} and ${run.orgId} = ${orgId} and ${checkResult.orgId} = ${orgId})`
    const scope = and(eq(audit.orgId, orgId), inArray(audit.siteId, [...siteIds]))
    const counts = yield* db
      .select({
        siteId: audit.siteId,
        total: sql<number>`count(*) filter (where ${audit.kind} = 'full')`.mapWith(Number),
        running:
          sql<number>`count(*) filter (where ${audit.status} in ('queued', 'running'))`.mapWith(
            Number,
          ),
        lastAuditAt:
          sql<Date | null>`max(${audit.createdAt}) filter (where ${audit.kind} = 'full')`.mapWith(
            audit.createdAt,
          ),
      })
      .from(audit)
      .where(scope)
      .groupBy(audit.siteId)
    const lasts = yield* db
      .selectDistinctOn([audit.siteId], {
        id: audit.id,
        siteId: audit.siteId,
        createdAt: audit.createdAt,
        status: audit.status,
      })
      .from(audit)
      .where(and(scope, eq(audit.kind, "full"), inArray(audit.status, [...SETTLED])))
      .orderBy(audit.siteId, desc(hasChecks), desc(audit.createdAt), desc(audit.id))
    const countsBySite = new Map(counts.map((c) => [c.siteId, c]))
    const lastBySite = new Map(lasts.map((l) => [l.siteId, l]))
    const picked = siteIds.map((siteId) => ({
      siteId,
      counts: countsBySite.get(siteId),
      last: lastBySite.get(siteId),
    }))
    const details = yield* auditDetails(
      orgId,
      picked.flatMap((p) => (p.last === undefined ? [] : [p.last.id])),
    )
    const detailById = new Map(details.map((d) => [d.id, d]))
    const scores = yield* scoresOf(orgId, details)
    for (const { siteId, counts: own, last } of picked) {
      const detail = last === undefined ? undefined : detailById.get(last.id)
      summaries.set(siteId, {
        latest:
          last === undefined || detail === undefined
            ? null
            : latestOf(last, detail, scores.get(last.id)),
        running: own?.running ?? 0,
        auditCount: own?.total ?? 0,
        lastAuditAt: own?.lastAuditAt ?? null,
      })
    }
    return summaries
  })

export type Attention = {
  reason: "incomplete" | "critical" | "unshared"
  /** The audit the action opens: the latest settled one for `incomplete`, else the latest evaluated one. */
  auditId: string
  /** The latest settled audit's status; only `incomplete` reads it. */
  status: string
  failed: number
  partial: number
  runs: number
  critical: number
}

/** A report older than this with failing findings and no live share link needs attention. */
const UNSHARED_AFTER_MS = 24 * 60 * 60 * 1000

/**
 * Why each site needs attention, if it does (a site that does not is absent): the first of an
 * unfinished latest audit, open Critical findings, or an old report nobody was given a link to.
 * Only full audits count. Grouped queries for all sites, never one per site.
 */
export const attentionOf = (orgId: string, siteIds: readonly string[]) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const attention = new Map<string, Attention>()
    if (siteIds.length === 0) return attention
    const scope = and(
      eq(audit.orgId, orgId),
      inArray(audit.siteId, [...siteIds]),
      eq(audit.kind, "full"),
      inArray(audit.status, [...SETTLED]),
    )
    const newest = [audit.siteId, desc(audit.createdAt), desc(audit.id)] as const
    const settled = yield* db
      .selectDistinctOn([audit.siteId], {
        id: audit.id,
        siteId: audit.siteId,
        status: audit.status,
      })
      .from(audit)
      .where(scope)
      .orderBy(...newest)
    const evaluated = yield* db
      .selectDistinctOn([audit.siteId], {
        id: audit.id,
        siteId: audit.siteId,
        finishedAt: audit.finishedAt,
      })
      .from(audit)
      .where(
        and(
          scope,
          sql`exists (select 1 from ${run} join ${checkResult} on ${checkResult.runId} = ${run.id} where ${run.auditId} = ${audit.id} and ${run.orgId} = ${orgId} and ${checkResult.orgId} = ${orgId})`,
        ),
      )
      .orderBy(...newest)
    const runCounts = yield* db
      .select({ auditId: run.auditId, status: run.status, n: count() })
      .from(run)
      .where(
        and(
          eq(run.orgId, orgId),
          inArray(
            run.auditId,
            settled.map((s) => s.id),
          ),
        ),
      )
      .groupBy(run.auditId, run.status)
    const evaluatedIds = evaluated.map((e) => e.id)
    const criticals = new Map(
      (yield* auditDetails(orgId, evaluatedIds)).map((d) => [d.id, d.critical]),
    )
    const failing = new Set(
      evaluatedIds.length === 0
        ? []
        : (yield* db
            .selectDistinct({ auditId: finding.auditId })
            .from(finding)
            .where(
              and(
                eq(finding.orgId, orgId),
                inArray(finding.auditId, evaluatedIds),
                eq(finding.kind, "fail"),
              ),
            )).map((f) => f.auditId),
    )
    const cutoff = Date.now() - UNSHARED_AFTER_MS
    const stale = evaluated.filter(
      (e) => e.finishedAt !== null && e.finishedAt.getTime() < cutoff && failing.has(e.id),
    )
    const shared = yield* liveShares(
      orgId,
      stale.map((e) => e.id),
    )
    const runsOf = (auditId: string, status?: string) =>
      runCounts
        .filter((r) => r.auditId === auditId && (status === undefined || r.status === status))
        .reduce((n, r) => n + r.n, 0)
    const settledBySite = new Map(settled.map((s) => [s.siteId, s]))
    const evaluatedBySite = new Map(evaluated.map((e) => [e.siteId, e]))
    for (const siteId of siteIds) {
      const last = settledBySite.get(siteId)
      const lastEvaluated = evaluatedBySite.get(siteId)
      if (last !== undefined) {
        const failed = runsOf(last.id, "failed")
        const partial = runsOf(last.id, "partial")
        if (last.status === "failed" || (last.status === "partial" && failed + partial > 0)) {
          attention.set(siteId, {
            reason: "incomplete",
            auditId: last.id,
            status: last.status,
            failed,
            partial,
            runs: runsOf(last.id),
            critical: 0,
          })
          continue
        }
      }
      if (lastEvaluated === undefined) continue
      const critical = criticals.get(lastEvaluated.id) ?? 0
      const base = {
        auditId: lastEvaluated.id,
        status: "complete",
        failed: 0,
        partial: 0,
        runs: 0,
        critical,
      }
      if (critical > 0) attention.set(siteId, { ...base, reason: "critical" })
      else if (stale.includes(lastEvaluated) && !shared.has(lastEvaluated.id))
        attention.set(siteId, { ...base, reason: "unshared" })
    }
    return attention
  })

const openCount = (orgId: string, severity: string) =>
  sql<number>`(
  select count(*) from ${finding}
  left join ${findingTriage} on ${findingTriage.auditId} = ${finding.auditId}
    and ${findingTriage.ruleId} = ${finding.ruleId} and ${findingTriage.orgId} = ${orgId}
  where ${finding.auditId} = ${audit.id} and ${finding.orgId} = ${orgId}
    and ${finding.kind} = 'fail' and ${finding.severity} = ${severity}
    and coalesce(${findingTriage.status}, 'open') = 'open'
)`.mapWith(Number)

const coverageOf = (a: { evaluated: number; total: number }): Latest["coverage"] => {
  if (a.evaluated === 0) return "not-evaluated"
  return a.evaluated === a.total ? "full" : "partial"
}
