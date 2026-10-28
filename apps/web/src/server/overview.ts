import { createServerFn } from "@tanstack/react-start"
import { Database } from "@repo/core/Database"
import { audit, checkResult, finding, run } from "@repo/db"
import { and, asc, eq, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { runReason } from "@/lib/audit-labels"
import { auditInOrg } from "./audit-data"
import { briefingOf } from "./compare-data"
import { findingsOf, SEVERITY_ORDER } from "./findings-data"
import { tagsSeenOf } from "./matrix-data"
import { requireSession } from "./require-session"
import { scoreSummaryOf } from "./score-summary"
import { membership, read } from "./server-fn"

const decodeFix = Schema.decodeUnknownEffect(Schema.Array(Schema.String))
const decodeStartPage = Schema.decodeUnknownEffect(
  Schema.Struct({ pages: Schema.NonEmptyArray(Schema.String) }),
)
const decodeErrors = Schema.decodeUnknownEffect(
  Schema.NullOr(Schema.Array(Schema.Struct({ code: Schema.String, message: Schema.String }))),
)

/**
 * What the Overview shows, computed from the stored findings and check results on every read:
 * the score, the counts by area (failing findings by severity, and rules that could not be
 * checked), the triage tally, the worst open failing finding in full (the stored text of the
 * finding and the message of its first failing run) and the tags seen. Triage does not change
 * the score or the counts, only which finding is the worst; `withoutAccepted` is the same score
 * with accepted risks left out, for the one place that shows both. `runHealth` says whether the
 * start page could not be loaded or most runs did not finish, which makes the score incomplete.
 */
export const getOverview = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ auditId: Schema.String })))
  .handler(({ context, data }) =>
    read(
      Effect.gen(function* () {
        const { organizationId: orgId } = yield* membership(context.session)
        const auditId = yield* auditInOrg(orgId, data.auditId)
        const { status, coverage, uncertainty, findings } = yield* findingsOf(orgId, auditId)
        const failing = findings.filter((f) => f.kind === "fail")
        const areas = new Map<
          string,
          { critical: number; warning: number; info: number; couldNotCheck: number }
        >()
        const areaOf = (area: string) => {
          const found = areas.get(area) ?? { critical: 0, warning: 0, info: 0, couldNotCheck: 0 }
          areas.set(area, found)
          return found
        }
        for (const f of failing) areaOf(f.area)[f.severity] += 1
        const unchecked = findings.filter((f) => f.kind === "inconclusive")
        for (const f of unchecked) areaOf(f.area).couldNotCheck += 1
        const top = failing
          .filter((f) => f.triage.status === "open")
          .toSorted(
            (a, b) =>
              SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
              b.failingRuns - a.failingRuns ||
              a.ruleId.localeCompare(b.ruleId),
          )[0]
        const { db } = yield* Database
        let worst = null
        if (top !== undefined) {
          const [stored] = yield* db
            .select({ why: finding.why, fix: finding.fix })
            .from(finding)
            .where(
              and(
                eq(finding.auditId, auditId),
                eq(finding.orgId, orgId),
                eq(finding.ruleId, top.ruleId),
              ),
            )
            .limit(1)
          const [first] = yield* db
            .select({ runId: checkResult.runId, message: checkResult.message })
            .from(checkResult)
            .innerJoin(run, eq(run.id, checkResult.runId))
            .where(
              and(
                eq(run.auditId, auditId),
                eq(run.role, "target"),
                eq(run.orgId, orgId),
                eq(checkResult.orgId, orgId),
                eq(checkResult.ruleId, top.ruleId),
                eq(checkResult.status, "fail"),
              ),
            )
            .orderBy(asc(run.ordinal))
            .limit(1)
          if (stored !== undefined && first !== undefined)
            worst = {
              ruleId: top.ruleId,
              severity: top.severity,
              title: top.title,
              why: stored.why,
              fix: yield* decodeFix(stored.fix).pipe(Effect.orDie),
              message: first.message,
              firstRunId: first.runId,
              failingRuns: top.failingRuns,
              knownRuns: top.knownRuns,
              pages: top.pages,
              scenarios: top.scenarios,
              bannerUncertainRuns: top.bannerUncertainRuns,
            }
        }
        const tags = yield* tagsSeenOf(orgId, auditId)
        const checked = yield* db
          .select({
            area: checkResult.area,
            passedRules:
              sql<number>`count(distinct ${checkResult.ruleId}) filter (where ${checkResult.status} = 'pass')`.mapWith(
                Number,
              ),
            checks: sql<number>`count(*)`.mapWith(Number),
            unresolved:
              sql<number>`count(*) filter (where ${checkResult.status} = 'inconclusive')`.mapWith(
                Number,
              ),
          })
          .from(checkResult)
          .innerJoin(run, eq(run.id, checkResult.runId))
          .where(
            and(
              eq(run.auditId, auditId),
              eq(run.role, "target"),
              eq(run.orgId, orgId),
              eq(checkResult.orgId, orgId),
            ),
          )
          .groupBy(checkResult.area)
        const [stored] = yield* db
          .select({ config: audit.config })
          .from(audit)
          .where(and(eq(audit.id, auditId), eq(audit.orgId, orgId)))
          .limit(1)
        const [startUrl] =
          stored === undefined
            ? []
            : (yield* decodeStartPage(stored.config).pipe(Effect.orDie)).pages
        const runRows = yield* db
          .select({
            pageUrl: run.pageUrl,
            status: run.status,
            failure: run.failure,
            errors: run.errors,
          })
          .from(run)
          .where(and(eq(run.auditId, auditId), eq(run.role, "target"), eq(run.orgId, orgId)))
          .orderBy(asc(run.ordinal))
        const runs = yield* Effect.forEach(runRows, (r) =>
          Effect.map(decodeErrors(r.errors).pipe(Effect.orDie), (errors) => ({
            ...r,
            errors: errors ?? [],
          })),
        )
        const openOf = (severity: string) =>
          failing.filter((f) => f.severity === severity && f.triage.status === "open").length
        const summary = scoreSummaryOf({
          findings: failing,
          uncertainty,
          coverage,
          runs,
          startUrl,
          reasonOf: runReason,
        })
        const briefing = yield* briefingOf(orgId, auditId)
        const [self] = yield* db
          .select({ kind: audit.kind, ruleId: audit.narrowRuleId })
          .from(audit)
          .where(and(eq(audit.id, auditId), eq(audit.orgId, orgId)))
        const rechecked = findings.find((f) => f.ruleId === self?.ruleId)
        // a re-check's result: how many of the runs it re-checked still fail the check
        const recheck =
          self?.kind === "narrow" && self.ruleId !== null
            ? {
                ruleId: self.ruleId,
                title: rechecked?.title ?? null,
                failingRuns: rechecked?.failingRuns ?? 0,
                runs: coverage.totalRuns,
              }
            : null
        return {
          briefing,
          recheck,
          runHealth: summary.runHealth,
          scoreCoverage: {
            totalRuns: coverage.totalRuns,
            evaluatedRuns: coverage.evaluatedRuns,
            unfinishedRuns: summary.runHealth.unfinishedRuns,
            checks: checked.reduce((n, c) => n + c.checks, 0),
            unresolvedChecks: checked.reduce((n, c) => n + c.unresolved, 0),
            unauditedSites: 0,
          },
          open: {
            critical: openOf("critical"),
            warning: openOf("warning"),
            info: openOf("info"),
          },
          couldNotCheck: {
            rules: unchecked.length,
            runs: new Set(unchecked.flatMap((f) => f.runIds)).size,
            titles: unchecked.map((f) => f.checkTitle).toSorted(),
          },
          checkedAreas: Object.fromEntries(checked.map((c) => [c.area, c.passedRules])),
          withoutAccepted: summary.withoutAccepted,
          worst,
          tags,
          status,
          coverage,
          score: summary.score,
          bannerUncertain: failing
            .filter((f) => f.bannerUncertainRuns > 0)
            .map((f) => ({ ruleId: f.ruleId, title: f.title, runs: f.bannerUncertainRuns })),
          areas: Object.fromEntries(areas),
          triage: {
            acceptedRisk: failing.filter((f) => f.triage.status === "accepted_risk").length,
            fixed: failing.filter((f) => f.triage.status === "fixed").length,
          },
        }
      }),
    ),
  )
