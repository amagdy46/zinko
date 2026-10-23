import { Database } from "@repo/core/Database"
import { audit, checkResult, finding, findingTriage, run } from "@repo/db"
import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { Effect } from "effect"

type Latest = {
  auditId: string
  createdAt: Date
  status: string
  coverage: "full" | "partial" | "not-evaluated"
  couldNotCheck: number
  openFindings: { critical: number; warning: number; info: number }
}

// Only settled audits expose aggregated findings: persist writes checks before finish writes findings.
export const auditSummaries = (orgId: string, siteIds: readonly string[]) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    if (siteIds.length === 0) return []
    return yield* db
      .select({
        id: audit.id,
        siteId: audit.siteId,
        createdAt: audit.createdAt,
        status: audit.status,
        total:
          sql<number>`(select count(*) from ${run} where ${run.auditId} = ${audit.id} and ${run.orgId} = ${orgId})`.mapWith(
            Number,
          ),
        finished:
          sql<number>`(select count(*) from ${run} where ${run.auditId} = ${audit.id} and ${run.orgId} = ${orgId} and ${run.status} in ('complete', 'partial', 'failed'))`.mapWith(
            Number,
          ),
        evaluated:
          sql<number>`(select count(*) from ${run} where ${run.auditId} = ${audit.id} and ${run.orgId} = ${orgId} and exists (select 1 from ${checkResult} where ${checkResult.runId} = ${run.id} and ${checkResult.orgId} = ${orgId}))`.mapWith(
            Number,
          ),
        critical: openCount(orgId, "critical"),
        warning: openCount(orgId, "warning"),
        info: openCount(orgId, "info"),
        couldNotCheck:
          sql<number>`(select count(*) from ${finding} where ${finding.auditId} = ${audit.id} and ${finding.orgId} = ${orgId} and ${finding.kind} = 'inconclusive')`.mapWith(
            Number,
          ),
      })
      .from(audit)
      .where(and(eq(audit.orgId, orgId), inArray(audit.siteId, [...siteIds])))
      .orderBy(desc(audit.createdAt), desc(audit.id))
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
  if (results.some((r) => r.coverage === "not-evaluated")) return "not-evaluated"
  if (results.length !== siteCount || results.some((r) => r.coverage === "partial"))
    return "partial"
  return "full"
}

export const settled = (status: string) => ["complete", "partial", "failed"].includes(status)
type AuditSummary = Effect.Success<ReturnType<typeof auditSummaries>>[number]

export const siteSummary = (rows: readonly AuditSummary[]) => {
  const last =
    rows.find((a) => settled(a.status) && a.evaluated > 0) ?? rows.find((a) => settled(a.status))
  const latest: Latest | null =
    last === undefined
      ? null
      : {
          auditId: last.id,
          createdAt: last.createdAt,
          status: last.status,
          coverage: coverageOf(last),
          couldNotCheck: last.couldNotCheck,
          openFindings: { critical: last.critical, warning: last.warning, info: last.info },
        }
  return {
    latest,
    running: rows.filter((a) => a.status === "queued" || a.status === "running").length,
    auditCount: rows.length,
    lastAuditAt: rows[0]?.createdAt ?? null,
  }
}

export const clientSummary = (sites: readonly ReturnType<typeof siteSummary>[]) => {
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
