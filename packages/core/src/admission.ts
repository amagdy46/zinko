import { Context, Data, type Effect, Schema } from "effect"

export class AdmissionError extends Data.TaggedError("AdmissionError")<{
  readonly operation: string
  readonly cause: unknown
}> {}

/**
 * With `engine` (a `Browser.capture` instance name) the audit holds that engine until it releases it
 * or stops asking; with `position` it waits in line (1 is next).
 */
export const Admission = Schema.Union([
  Schema.Struct({ engine: Schema.String }),
  Schema.Struct({ position: Schema.Number }),
])
export type Admission = typeof Admission.Type

/** The workflow event that tells a waiting audit an engine was handed to it. */
export const ENGINE_FREE_EVENT = "engine-free"

/**
 * Hands the capture engines to audits one audit per engine, first come first served. An audit
 * asks before each capture; while it keeps asking it keeps its engine, and it releases it when its
 * last run is done.
 */
export class CaptureAdmission extends Context.Service<
  CaptureAdmission,
  {
    readonly admit: (auditId: string) => Effect.Effect<Admission, AdmissionError>
    readonly release: (auditId: string) => Effect.Effect<void, AdmissionError>
  }
>()("@repo/core/CaptureAdmission") {}
