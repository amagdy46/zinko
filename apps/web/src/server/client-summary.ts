import { Database } from "@repo/core/Database"
import { audit, checkResult, finding, findingTriage, run, site } from "@repo/db"
import { and, count, desc, eq, inArray, lte, max, sql } from "drizzle-orm"
import { Effect } from "effect"
import {
  healthScore,
  scoreCoverage,
  type ScoreCoverage,
  type ScoreFinding,
} from "@/lib/health-score"
import { decodeSeverity } from "./findings-data"

type Latest = {
  auditId: string
  createdAt: Date
  status: string
  coverage: "full" | "partial" | "not-evaluated"
  couldNotCheck: number
  /** Runs that ended partial or failed. */
  incompleteRuns: number
  /** The health score; the lowest of the sites' when `sites` is more than 1. Null when not evaluated. */
  score: number | null
  sites: number
  /** What the score was computed from, summed over the sites when `sites` is more than 1. */
  scoreCoverage: ScoreCoverage
  /** Runs in the audit the score comes from; the newest audit's when `sites` is more than 1. */
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
          sql<number>`(select count(*) from ${finding} where ${finding.auditId} = ${audit.id} and ${finding.orgId} = ${orgId} and ${finding.inconclusiveRuns} > 0)`.mapWith(
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
    const scores = new Map<string, number>()
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
      if (result.evaluated) scores.set(d.id, result.score)
    }
    return scores
  })

const latestOf = (
  head: { id: string; createdAt: Date; status: string },
  detail: AuditDetail,
  score: number | undefined,
): Latest => ({
  auditId: head.id,
  createdAt: head.createdAt,
  status: head.status,
  coverage: coverageOf(detail),
  couldNotCheck: detail.couldNotCheck,
  incompleteRuns: detail.incomplete,
  score: score ?? null,
  scoreCoverage: coverageOfAudit(detail),
  sites: 1,
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
        total: count(),
        running:
          sql<number>`count(*) filter (where ${audit.status} in ('queued', 'running'))`.mapWith(
            Number,
          ),
        lastAuditAt: max(audit.createdAt),
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
      .where(and(scope, inArray(audit.status, [...SETTLED])))
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

const worstCoverage = (results: readonly Latest[], siteCount: number): Latest["coverage"] => {
  if (results.every((r) => r.coverage === "not-evaluated")) return "not-evaluated"
  return results.length === siteCount && results.every((r) => r.coverage === "full")
    ? "full"
    : "partial"
}

const lowestScore = (results: readonly Latest[]) => {
  const scores = results.flatMap((r) => (r.score === null ? [] : [r.score]))
  return scores.length === 0 ? null : Math.min(...scores)
}

const sum = (results: readonly Latest[], pick: (r: Latest) => number) =>
  results.reduce((n, r) => n + pick(r), 0)

export const clientSummary = (sites: readonly SiteSummary[]) => {
  const results = sites
    .flatMap((s) => (s.latest === null ? [] : [s.latest]))
    .toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  const newest = results[0]
  const latest: Latest | null =
    newest === undefined
      ? null
      : {
          ...newest,
          coverage: worstCoverage(results, sites.length),
          couldNotCheck: results.reduce((n, r) => n + r.couldNotCheck, 0),
          incompleteRuns: results.reduce((n, r) => n + r.incompleteRuns, 0),
          score: lowestScore(results),
          scoreCoverage: {
            totalRuns: sum(results, (r) => r.scoreCoverage.totalRuns),
            evaluatedRuns: sum(results, (r) => r.scoreCoverage.evaluatedRuns),
            unfinishedRuns: sum(results, (r) => r.scoreCoverage.unfinishedRuns),
            checks: sum(results, (r) => r.scoreCoverage.checks),
            unresolvedChecks: sum(results, (r) => r.scoreCoverage.unresolvedChecks),
            unauditedSites: sites.length - results.length,
          },
          sites: results.length,
          openFindings: results.reduce(
            (n, r) => ({
              critical: n.critical + r.openFindings.critical,
              warning: n.warning + r.openFindings.warning,
              info: n.info + r.openFindings.info,
            }),
            { critical: 0, warning: 0, info: 0 },
          ),
        }
  return { latest, running: sites.reduce((n, s) => n + s.running, 0) }
}

const TREND_AUDITS = 5

export type TrendPoint = { score: number; full: boolean }

/**
 * The last few scored audits of each client (settled, with check results), oldest first, from one
 * ranked query plus the batched detail and score queries, so a list of clients costs the same
 * number of queries as one client.
 */
export const trendsOf = (orgId: string, clientIds: readonly string[]) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const trends = new Map<string, TrendPoint[]>()
    if (clientIds.length === 0) return trends
    const ranked = db
      .select({
        id: audit.id,
        clientId: site.clientId,
        rank: sql<number>`row_number() over (partition by ${site.clientId} order by ${audit.createdAt} desc, ${audit.id} desc)`
          .mapWith(Number)
          .as("rank"),
      })
      .from(audit)
      .innerJoin(site, eq(site.id, audit.siteId))
      .where(
        and(
          eq(audit.orgId, orgId),
          eq(site.orgId, orgId),
          inArray(site.clientId, [...clientIds]),
          inArray(audit.status, [...SETTLED]),
        ),
      )
      .as("ranked")
    const recent = yield* db
      .select({ id: ranked.id, clientId: ranked.clientId })
      .from(ranked)
      .where(lte(ranked.rank, TREND_AUDITS))
      .orderBy(desc(ranked.rank))
    const details = yield* auditDetails(
      orgId,
      recent.map((r) => r.id),
    )
    const scores = yield* scoresOf(orgId, details)
    const detailById = new Map(details.map((d) => [d.id, d]))
    for (const { id, clientId } of recent) {
      const score = scores.get(id)
      const detail = detailById.get(id)
      if (score === undefined || detail === undefined) continue
      trends.set(clientId, [
        ...(trends.get(clientId) ?? []),
        { score, full: scoreCoverage(coverageOfAudit(detail)).state !== "runs" },
      ])
    }
    return trends
  })
