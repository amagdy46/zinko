import { CaptureResult } from "@repo/capture-contract"
import { Database } from "@repo/core/Database"
import { run } from "@repo/db"
import { and, eq } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"

export type BannerDetection = "detected" | "not-detected" | "unknown"

/**
 * The consent rules whose verdict under `none` depends on a banner existing. Not `gpc` (the signal
 * applies without a banner), not `default-after-tag` (an ordering bug whatever the banner), not
 * `pixel-after-reject` (it needs a banner by definition).
 */
export const BANNER_DEPENDENT_RULES: ReadonlyArray<string> = [
  "consent.pixel-without-consent",
  "consent.cookies-without-consent",
  "consent.google-without-denied-state",
]

/** The errors `evaluateRun` tolerates: the page was captured in full, only the choice is unknown. */
const BANNER_ERRORS: ReadonlySet<string> = new Set(["CmpNotFound", "ConsentNotApplied"])

const decodeConsent = Schema.decodeUnknownOption(CaptureResult.fields.consent)
const decodeErrors = Schema.decodeUnknownOption(
  Schema.Array(Schema.Struct({ code: Schema.String, message: Schema.String })),
)

/**
 * For each `none` run of the audit, whether the audit's own accept and reject runs of the same page,
 * viewport and journey flag found a banner. The engine only looks for a banner when it must act, so
 * `none` and `gpc` never do. `not-detected` needs both siblings usable and every usable one
 * `not-found`; any other outcome is `detected`; one missing, failed or unusable sibling is `unknown`.
 */
export const bannerDetection = (orgId: string, auditId: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const rows = yield* db
      .select({
        id: run.id,
        pageUrl: run.pageUrl,
        viewport: run.viewport,
        journey: run.journey,
        scenario: run.scenario,
        consent: run.consent,
        errors: run.errors,
        complete: run.complete,
      })
      .from(run)
      .where(and(eq(run.auditId, auditId), eq(run.orgId, orgId)))
    const keyOf = (r: (typeof rows)[number]) => `${r.journey}|${r.viewport}|${r.pageUrl}`
    const outcomes = new Map<string, Map<string, string>>()
    for (const r of rows) {
      if (r.scenario !== "accept" && r.scenario !== "reject") continue
      const consent = Option.getOrNull(decodeConsent(r.consent))
      const errors = Option.getOrElse(decodeErrors(r.errors), () => [])
      const usable =
        consent !== null &&
        (r.complete === true ||
          (errors.length > 0 && errors.every((e) => BANNER_ERRORS.has(e.code))))
      if (!usable) continue
      const siblings = outcomes.get(keyOf(r)) ?? new Map<string, string>()
      siblings.set(r.scenario, consent.outcome)
      outcomes.set(keyOf(r), siblings)
    }
    const detection = new Map<string, BannerDetection>()
    for (const r of rows) {
      if (r.scenario !== "none") continue
      const seen = [...(outcomes.get(keyOf(r))?.values() ?? [])]
      if (seen.some((outcome) => outcome !== "not-found")) detection.set(r.id, "detected")
      else detection.set(r.id, seen.length === 2 ? "not-detected" : "unknown")
    }
    return detection
  })
