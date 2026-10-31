import { JOURNEY_STEPS } from "@repo/core/audit"
import { createServerFn } from "@tanstack/react-start"
import { Effect, Schema } from "effect"
import { runBreakdown } from "@/lib/audit-labels"
import { narrowedConfig } from "@/lib/compare"
import { createAudit } from "./audit-create"
import { launchAudit } from "./audit-launch"
import { BANNER_DEPENDENT_RULES } from "./consent-context"
import { recheckPlanOf } from "./compare-data"
import { requireSession } from "./require-session"
import { Invalid, membership, mutation, read, siteInOrg } from "./server-fn"

const RecheckInput = Schema.Struct({
  auditId: Schema.String,
  ruleId: Schema.String,
  against: Schema.optionalKey(Schema.String),
})

/**
 * The pages and scenarios of a re-check: the cells the rule fails on (and failed on in `against`),
 * the config that reproduces them, and how many extra runs it takes. Read from stored audits only;
 * the client sends ids, never a config.
 */
const planOf = (
  orgId: string,
  data: { auditId: string; ruleId: string; against?: string | undefined },
) =>
  Effect.gen(function* () {
    const plan = yield* recheckPlanOf(orgId, data.auditId, data.against, data.ruleId)
    const site = yield* siteInOrg(orgId, plan.siteId)
    const narrowed = narrowedConfig(
      plan.config,
      plan.targets,
      BANNER_DEPENDENT_RULES.includes(data.ruleId),
      site.measuredHosts,
    )
    let unavailable: string | null = null
    if (site.archivedAt !== null) unavailable = "This site is archived."
    if (narrowed === null)
      unavailable = "This check fails nowhere that can be re-checked as it was captured."
    return { site, plan, narrowed, unavailable }
  })

const summaryOf = (planned: Effect.Success<ReturnType<typeof planOf>>) => {
  const { narrowed } = planned
  if (narrowed === null) return null
  const { config } = narrowed
  const breakdown = runBreakdown({
    pages: config.pages.length,
    scenarios: config.scenarios.length,
    viewports: config.viewports.length,
    journeySteps:
      config.journey === true && config.pages.length > 1
        ? Math.min(config.pages.length - 1, JOURNEY_STEPS)
        : 0,
    crossHostRuns: config.crossHost === true ? (config.measuredHosts?.length ?? 0) : 0,
  })
  return {
    runs: breakdown.runs,
    duration: breakdown.duration,
    targets: narrowed.targets.length,
    bannerRuns: narrowed.companions.length,
    dropped: narrowed.dropped.length,
    pages: new Set(narrowed.targets.map((t) => t.page)).size,
  }
}

/** What a re-check of a rule would run, read-only (the Verify fix and Re-check dialogs). */
export const previewRecheck = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(RecheckInput))
  .handler(({ context, data }) =>
    read(
      Effect.gen(function* () {
        const { organizationId: orgId } = yield* membership(context.session)
        const planned = yield* planOf(orgId, data)
        return { unavailable: planned.unavailable, summary: summaryOf(planned) }
      }),
    ),
  )

/**
 * Starts a re-check: a `narrow` audit of the cells a rule fails on, so a fix (or a change that may
 * be a flaky result) can be confirmed on exactly those pages. It has no baseline and carries nothing
 * over.
 */
export const recheck = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(RecheckInput))
  .handler(({ context, data }) =>
    mutation(
      Effect.gen(function* () {
        const { organizationId: orgId, userId } = yield* membership(context.session)
        const { site, plan, narrowed, unavailable } = yield* planOf(orgId, data)
        if (unavailable !== null || narrowed === null)
          return yield* new Invalid({ message: unavailable ?? "Nothing to re-check." })
        const auditId = yield* createAudit({
          orgId,
          userId,
          siteId: site.id,
          config: narrowed.config,
          origin: { kind: "new" },
          narrow: {
            ruleId: data.ruleId,
            targets: narrowed.targets,
            companions: narrowed.companions,
          },
        })
        yield* launchAudit(auditId)
        return { auditId, siteId: plan.siteId }
      }),
    ),
  )
