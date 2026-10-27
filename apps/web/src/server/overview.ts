import { createServerFn } from "@tanstack/react-start"
import { Effect, Schema } from "effect"
import { healthScore } from "@/lib/health-score"
import { auditInOrg } from "./audit-data"
import { findingsOf } from "./findings-data"
import { requireSession } from "./require-session"
import { membership, read } from "./server-fn"

/**
 * What the Overview shows, computed from the stored findings and check results on every read:
 * the score, the counts by area (failing findings by severity, and rules that could not be
 * checked) and the triage tally. Triage does not change the score or the counts.
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
        return {
          status,
          coverage,
          score: healthScore({
            findings: failing,
            uncertainty,
            evaluatedRuns: coverage.evaluatedRuns,
            totalRuns: coverage.totalRuns,
            versions: coverage.rulesVersions,
          }),
          areas: Object.fromEntries(areas),
          triage: {
            acceptedRisk: failing.filter((f) => f.triage.status === "accepted_risk").length,
            fixed: failing.filter((f) => f.triage.status === "fixed").length,
          },
        }
      }),
    ),
  )
