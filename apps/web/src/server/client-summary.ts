import { Database } from "@repo/core/Database"
import { audit, checkResult, finding, findingTriage, run } from "@repo/db"
import { and, count, desc, eq, inArray, max, sql } from "drizzle-orm"
import { Effect } from "effect"

type Latest = {
  auditId: string
  createdAt: Date
  status: string
  coverage: "full" | "partial" | "not-evaluated"
  couldNotCheck: number
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
        evaluated:
          sql<number>`(select count(*) from ${run} where ${runsWhere(orgId)} and exists (select 1 from ${checkResult} where ${checkResult.runId} = ${run.id} and ${checkResult.orgId} = ${orgId}))`.mapWith(
            Number,
          ),
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

type AuditDetail = Effect.Success<ReturnType<typeof auditDetails>>[number]

const latestOf = (
  head: { id: string; createdAt: Date; status: string },
  detail: AuditDetail,
): Latest => ({
  auditId: head.id,
  createdAt: head.createdAt,
  status: head.status,
  coverage: coverageOf(detail),
  couldNotCheck: detail.couldNotCheck,
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
    for (const { siteId, counts: own, last } of picked) {
      const detail = last === undefined ? undefined : detailById.get(last.id)
      summaries.set(siteId, {
        latest: last === undefined || detail === undefined ? null : latestOf(last, detail),
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
