import { MAX_URL_LENGTH, Scenario } from "@repo/capture-contract"
import { Context, Data, type Effect, Schema } from "effect"

const unique = (items: ReadonlyArray<unknown>) => new Set(items).size === items.length

/**
 * What an audit captures: every page under every scenario at every viewport, in that order. The
 * first page is the start URL. The server checks every page against the audit's site
 * (`isOnSite`) when the audit starts.
 */
export const AuditConfig = Schema.Struct({
  pages: Schema.Array(Schema.String.check(Schema.isMaxLength(MAX_URL_LENGTH))).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(20),
    Schema.makeFilter(unique, { expected: "no repeated page" }),
  ),
  scenarios: Schema.Array(Scenario).check(
    Schema.isMinLength(1),
    Schema.makeFilter(unique, { expected: "no repeated scenario" }),
  ),
  viewports: Schema.Array(Schema.Literals(["desktop", "mobile"])).check(
    Schema.isMinLength(1),
    Schema.makeFilter(unique, { expected: "no repeated viewport" }),
  ),
  /** Adds `TEST_CLICK_IDS` to the start URL. */
  clickIds: Schema.Boolean,
  /** Vendor collection requests are answered locally and never reach the vendor. */
  blockVendorRequests: Schema.Boolean,
  /**
   * Adds journey runs: the start URL, then the first `JOURNEY_STEPS` key pages in order, in one
   * browser context. Optional, so configs stored before M3 still decode.
   */
  journey: Schema.optionalKey(Schema.Boolean),
})
export type AuditConfig = typeof AuditConfig.Type

/** How many key pages a journey run walks through: the engine takes at most 5 steps. */
export const JOURNEY_STEPS = 5

/**
 * Appended to the start URL only, when `clickIds` is on: a landing from an ad. Journey runs show
 * whether they survive into the key pages.
 */
export const TEST_CLICK_IDS = {
  gclid: "ZINKO-TEST-GCLID",
  fbclid: "ZINKO-TEST-FBCLID",
  ttclid: "ZINKO-TEST-TTCLID",
  utm_source: "zinko",
  utm_medium: "cpc",
  utm_campaign: "zinko-audit",
} as const

const RunError = Schema.Struct({ code: Schema.String, message: Schema.String })

/** What the audit room pushes to open tabs. The page refetches the audit; the event only says when. */
export const AuditEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("run"),
    runId: Schema.String,
    ordinal: Schema.Finite,
    status: Schema.String,
    hitCount: Schema.Finite,
    errors: Schema.Array(RunError),
  }),
  Schema.Struct({ type: Schema.Literal("audit"), status: Schema.String }),
])
export type AuditEvent = typeof AuditEvent.Type

export class AuditProgressError extends Data.TaggedError("AuditProgressError")<{
  readonly operation: string
  readonly cause: unknown
}> {}

/** Pushes progress of a running audit to the browsers watching it. */
export class AuditProgress extends Context.Service<
  AuditProgress,
  {
    readonly publish: (
      auditId: string,
      event: AuditEvent,
    ) => Effect.Effect<void, AuditProgressError>
  }
>()("@repo/core/AuditProgress") {}
