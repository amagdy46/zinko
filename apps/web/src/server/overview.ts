import { createServerFn } from "@tanstack/react-start"
import { Database } from "@repo/core/Database"
import { audit, checkResult, finding, run } from "@repo/db"
import { and, asc, eq, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { runReason } from "@/lib/audit-labels"
import { healthScore } from "@/lib/health-score"
import { auditInOrg } from "./audit-data"
import { findingsOf, SEVERITY_ORDER } from "./findings-data"
import { tagsSeenOf } from "./matrix-data"
import { requireSession } from "./require-session"
import { membership, read } from "./server-fn"

const decodeFix = Schema.decodeUnknownEffect(Schema.Array(Schema.String))
const decodeStartPage = Schema.decodeUnknownEffect(
  Schema.Struct({ pages: Schema.NonEmptyArray(Schema.String) }),
)
const decodeErrors = Schema.decodeUnknownEffect(
  Schema.NullOr(Schema.Array(Schema.Struct({ code: Schema.String, message: Schema.String }))),
)

const LOAD_FAILURES = new Set(["Navigation", "HttpStatus", "Timeout"])
const withoutQuery = (url: string) => url.split("?")[0]

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
        for (const f of findings) if (f.inconclusiveRuns > 0) areaOf(f.area).couldNotCheck += 1
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
          .where(and(eq(run.auditId, auditId), eq(run.orgId, orgId), eq(checkResult.orgId, orgId)))
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
          .where(and(eq(run.auditId, auditId), eq(run.orgId, orgId)))
          .orderBy(asc(run.ordinal))
        const runs = yield* Effect.forEach(runRows, (r) =>
          Effect.map(decodeErrors(r.errors).pipe(Effect.orDie), (errors) => ({
            ...r,
            errors: errors ?? [],
          })),
        )
        const startRuns = runs.filter(
          (r) => startUrl !== undefined && withoutQuery(r.pageUrl) === withoutQuery(startUrl),
        )
        const loadFailed = (r: (typeof runs)[number]) =>
          r.status === "failed" ||
          (r.status === "partial" && r.errors.some((e) => LOAD_FAILURES.has(e.code)))
        const startFailed = startRuns.length > 0 && startRuns.every(loadFailed)
        const pages = new Map<string, Array<(typeof runs)[number]>>()
        for (const r of runs) {
          const page = r.pageUrl.split("?")[0] ?? r.pageUrl
          if (!startRuns.includes(r)) pages.set(page, [...(pages.get(page) ?? []), r])
        }
        const brokenPages = [...pages].flatMap(([page, [first, ...rest]]) =>
          first !== undefined && [first, ...rest].every(loadFailed)
            ? [{ page, reason: runReason(first) }]
            : [],
        )
        const unfinished = runs.filter((r) => r.status === "failed" || r.status === "partial")
        const openOf = (severity: string) =>
          failing.filter((f) => f.severity === severity && f.triage.status === "open").length
        const withoutAcceptedScore = healthScore({
          findings: failing.filter((f) => f.triage.status !== "accepted_risk"),
          uncertainty,
          evaluatedRuns: coverage.evaluatedRuns,
          totalRuns: coverage.totalRuns,
          versions: coverage.rulesVersions,
        })
        return {
          runHealth: {
            startFailed,
            startPage: startUrl ?? null,
            startReason: startFailed && startRuns[0] ? runReason(startRuns[0]) : null,
            brokenPages,
            unfinishedRuns: unfinished.length,
            incomplete:
              startFailed ||
              brokenPages.length > 0 ||
              (runs.length > 0 && unfinished.length * 2 >= runs.length),
          },
          scoreCoverage: {
            totalRuns: coverage.totalRuns,
            evaluatedRuns: coverage.evaluatedRuns,
            unfinishedRuns: unfinished.length,
            checks: checked.reduce((n, c) => n + c.checks, 0),
            unresolvedChecks: checked.reduce((n, c) => n + c.unresolved, 0),
            unauditedSites: 0,
          },
          open: {
            critical: openOf("critical"),
            warning: openOf("warning"),
            info: openOf("info"),
          },
          checkedAreas: Object.fromEntries(checked.map((c) => [c.area, c.passedRules])),
          withoutAccepted: withoutAcceptedScore.evaluated ? withoutAcceptedScore.score : null,
          worst,
          tags,
          status,
          coverage,
          score: healthScore({
            findings: failing,
            uncertainty,
            evaluatedRuns: coverage.evaluatedRuns,
            totalRuns: coverage.totalRuns,
            versions: coverage.rulesVersions,
          }),
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
