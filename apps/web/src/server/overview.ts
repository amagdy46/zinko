import { createServerFn } from "@tanstack/react-start"
import { Database } from "@repo/core/Database"
import { checkResult, finding, run } from "@repo/db"
import { and, asc, eq } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { healthScore } from "@/lib/health-score"
import { auditInOrg } from "./audit-data"
import { findingsOf, SEVERITY_ORDER } from "./findings-data"
import { tagsSeenOf } from "./matrix-data"
import { requireSession } from "./require-session"
import { membership, read } from "./server-fn"

const decodeFix = Schema.decodeUnknownEffect(Schema.Array(Schema.String))

/**
 * What the Overview shows, computed from the stored findings and check results on every read:
 * the score, the counts by area (failing findings by severity, and rules that could not be
 * checked), the triage tally, the worst open failing finding in full (the stored text of the
 * finding and the message of its first failing run) and the tags seen. Triage does not change
 * the score or the counts, only which finding is the worst.
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
        return {
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
