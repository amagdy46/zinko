import { Database } from "@repo/core/Database"
import { audit, checkResult, finding, findingTriage, run } from "@repo/db"
import { ruleById } from "@repo/rules"
import { and, asc, count, eq, inArray, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { AREAS } from "@/lib/audit-labels"
import { BANNER_DEPENDENT_RULES, bannerDetection } from "./consent-context"
import { NotFound } from "./server-fn"

export const TriageStatus = Schema.Literals(["open", "accepted_risk", "fixed"])
export const decodeTriageStatus = Schema.decodeUnknownEffect(TriageStatus)
export const FindingKind = Schema.Literals(["fail", "inconclusive"])
export const decodeKind = Schema.decodeUnknownEffect(FindingKind)
export const Severity = Schema.Literals(["critical", "warning", "info"])
export const decodeSeverity = Schema.decodeUnknownEffect(Severity)

export const SEVERITY_ORDER: Record<typeof Severity.Type, number> = {
  critical: 0,
  warning: 1,
  info: 2,
}

/** A finding with no triage row is `open`. */
export const triageOf = (row: typeof findingTriage.$inferSelect | null) =>
  row === null
    ? Effect.succeed({
        status: "open" as const,
        reason: null,
        updatedBy: null,
        updatedAt: null,
      })
    : decodeTriageStatus(row.status).pipe(
        Effect.orDie,
        Effect.map((status) => ({
          status,
          reason: row.reason,
          updatedBy: row.updatedBy,
          updatedAt: row.updatedAt,
        })),
      )

/** What the check is called when it could not be run: the stored title, then the rule's, then the area. */
export const checkTitleOf = (stored: string | null, ruleId: string, area: string) =>
  stored ?? ruleById(ruleId)?.checkTitle ?? `Check: ${AREAS[area] ?? area}`

export const triageJoin = and(
  eq(findingTriage.auditId, finding.auditId),
  eq(findingTriage.ruleId, finding.ruleId),
  eq(findingTriage.orgId, finding.orgId),
)

/**
 * The audit's findings, failing ones first by severity, then those that could not be checked.
 * `coverage.evaluatedRuns` counts the runs with check results: 0 means the audit was not
 * evaluated (an M2 audit, or no run reached `persist`), never that it is clean. `coverage.runs`
 * puts every run in exactly one bucket (failing, else could not check, else passed, else not
 * evaluated), so the four add up to `totalRuns`; `couldNotCheckOnFailingRuns` is how many of the
 * failing runs also had a check that could not run. `uncertainty` counts what could not be
 * checked from the check results, in three units: `checks` (rows), `runs` and `rules` (distinct),
 * a rule that also fails elsewhere included. `knownRuns` is the runs where a rule was pass or fail.
 */
export const findingsOf = (orgId: string, auditId: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    // Read first: `finish` writes the findings and settles the status in one transaction, so
    // a finished status here means the reads below see the findings (a later read could not).
    const [current] = yield* db
      .select({ status: audit.status })
      .from(audit)
      .where(and(eq(audit.id, auditId), eq(audit.orgId, orgId)))
      .limit(1)
    if (current === undefined) return yield* new NotFound({ message: "Not found" })
    const runs = yield* db
      .select({ id: run.id, pageUrl: run.pageUrl, scenario: run.scenario })
      .from(run)
      .where(and(eq(run.auditId, auditId), eq(run.orgId, orgId)))
    const evaluated = yield* db
      .select({
        rulesVersion: checkResult.rulesVersion,
        runs: sql<number>`count(distinct ${checkResult.runId})`.mapWith(Number),
      })
      .from(checkResult)
      .innerJoin(run, eq(run.id, checkResult.runId))
      .where(and(eq(run.auditId, auditId), eq(run.orgId, orgId), eq(checkResult.orgId, orgId)))
      .groupBy(checkResult.rulesVersion)
    const verdicts = yield* db
      .select({ runId: checkResult.runId, status: checkResult.status, n: count() })
      .from(checkResult)
      .innerJoin(run, eq(run.id, checkResult.runId))
      .where(and(eq(run.auditId, auditId), eq(run.orgId, orgId), eq(checkResult.orgId, orgId)))
      .groupBy(checkResult.runId, checkResult.status)
    const outcomes = yield* db
      .select({
        ruleId: checkResult.ruleId,
        status: checkResult.status,
        area: checkResult.area,
        checkTitle: checkResult.checkTitle,
        n: count(),
      })
      .from(checkResult)
      .innerJoin(run, eq(run.id, checkResult.runId))
      .where(and(eq(run.auditId, auditId), eq(run.orgId, orgId), eq(checkResult.orgId, orgId)))
      .groupBy(checkResult.ruleId, checkResult.status, checkResult.area, checkResult.checkTitle)
    const failedDependent = yield* db
      .select({ ruleId: checkResult.ruleId, runId: checkResult.runId })
      .from(checkResult)
      .innerJoin(run, eq(run.id, checkResult.runId))
      .where(
        and(
          eq(run.auditId, auditId),
          eq(run.orgId, orgId),
          eq(checkResult.orgId, orgId),
          eq(checkResult.status, "fail"),
          inArray(checkResult.ruleId, [...BANNER_DEPENDENT_RULES]),
        ),
      )
    const detection = yield* bannerDetection(orgId, auditId)
    const bannerUncertain = new Map<string, number>()
    for (const f of failedDependent)
      if ((detection.get(f.runId) ?? "detected") !== "detected")
        bannerUncertain.set(f.ruleId, (bannerUncertain.get(f.ruleId) ?? 0) + 1)
    const reasons = yield* db
      .select({
        ruleId: checkResult.ruleId,
        message: checkResult.message,
      })
      .from(checkResult)
      .innerJoin(run, eq(run.id, checkResult.runId))
      .where(
        and(
          eq(run.auditId, auditId),
          eq(run.orgId, orgId),
          eq(checkResult.orgId, orgId),
          eq(checkResult.status, "inconclusive"),
        ),
      )
      .orderBy(asc(run.ordinal))
    const rows = yield* db
      .select({ finding, triage: findingTriage })
      .from(finding)
      .leftJoin(findingTriage, triageJoin)
      .where(and(eq(finding.auditId, auditId), eq(finding.orgId, orgId)))
    const runById = new Map(runs.map((r) => [r.id, r]))
    const knownRuns = new Map<string, number>()
    const unchecked = { checks: 0, rules: new Set<string>(), titles: new Set<string>() }
    for (const o of outcomes) {
      if (o.status === "pass" || o.status === "fail")
        knownRuns.set(o.ruleId, (knownRuns.get(o.ruleId) ?? 0) + o.n)
      if (o.status === "inconclusive") {
        unchecked.checks += o.n
        unchecked.rules.add(o.ruleId)
        unchecked.titles.add(checkTitleOf(o.checkTitle, o.ruleId, o.area))
      }
    }
    const reasonOf = new Map<string, string>()
    for (const r of reasons) if (!reasonOf.has(r.ruleId)) reasonOf.set(r.ruleId, r.message)
    const failingRuns = new Set(verdicts.filter((v) => v.status === "fail").map((v) => v.runId))
    const unsureRuns = new Set(
      verdicts.filter((v) => v.status === "inconclusive").map((v) => v.runId),
    )
    const checkedRuns = new Set(verdicts.map((v) => v.runId))
    const passingRuns = new Set(verdicts.filter((v) => v.status === "pass").map((v) => v.runId))
    let nothingApplied = 0
    const buckets = { failing: 0, couldNotCheck: 0, passed: 0, notEvaluated: 0 }
    for (const r of runs) {
      if (failingRuns.has(r.id)) buckets.failing += 1
      else if (unsureRuns.has(r.id)) buckets.couldNotCheck += 1
      else if (checkedRuns.has(r.id)) {
        buckets.passed += 1
        if (!passingRuns.has(r.id)) nothingApplied += 1
      } else buckets.notEvaluated += 1
    }
    const findings = yield* Effect.forEach(rows, ({ finding: f, triage }) =>
      Effect.gen(function* () {
        const affected = f.runIds.flatMap((id) => {
          const found = runById.get(id)
          return found === undefined ? [] : [found]
        })
        return {
          ruleId: f.ruleId,
          kind: yield* decodeKind(f.kind).pipe(Effect.orDie),
          area: f.area,
          severity: yield* decodeSeverity(f.severity).pipe(Effect.orDie),
          title: f.title,
          checkTitle: checkTitleOf(f.checkTitle, f.ruleId, f.area),
          reason: f.kind === "inconclusive" ? (reasonOf.get(f.ruleId) ?? null) : null,
          rulesVersions: f.rulesVersions,
          failingRuns: f.failingRuns,
          knownRuns: knownRuns.get(f.ruleId) ?? 0,
          bannerUncertainRuns: bannerUncertain.get(f.ruleId) ?? 0,
          inconclusiveRuns: f.inconclusiveRuns,
          runIds: f.runIds,
          pages: new Set(affected.map((r) => r.pageUrl)).size,
          scenarios: new Set(affected.map((r) => r.scenario)).size,
          triage: yield* triageOf(triage),
        }
      }),
    )
    return {
      status: current.status,
      coverage: {
        totalRuns: runs.length,
        // a run's check results are written together, with one version
        evaluatedRuns: evaluated.reduce((sum, e) => sum + e.runs, 0),
        runs: buckets,
        passedNothingApplied: nothingApplied,
        couldNotCheckOnFailingRuns: [...failingRuns].filter((id) => unsureRuns.has(id)).length,
        rulesVersions: evaluated.map((e) => e.rulesVersion).toSorted(),
      },
      uncertainty: {
        checks: unchecked.checks,
        runs: unsureRuns.size,
        rules: unchecked.rules.size,
        ruleTitles: [...unchecked.titles].toSorted(),
        bannerUncertainRuns: [...bannerUncertain.values()].reduce((sum, n) => sum + n, 0),
      },
      findings: findings.toSorted(
        (a, b) =>
          Number(a.kind === "inconclusive") - Number(b.kind === "inconclusive") ||
          SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
          a.ruleId.localeCompare(b.ruleId),
      ),
    }
  })
