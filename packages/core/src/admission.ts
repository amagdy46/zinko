import { Context, Data, type Effect, Schema } from "effect"

export class AdmissionError extends Data.TaggedError("AdmissionError")<{
  readonly operation: string
  readonly cause: unknown
}> {}

/** One capture's turn on `engine` (a `Browser.capture` instance name), identified by `token`. */
export const Grant = Schema.Struct({ engine: Schema.String, token: Schema.String })
export type Grant = typeof Grant.Type

/** A grant, or the audit's place in line (1 is next). */
export const Admission = Schema.Union([Grant, Schema.Struct({ position: Schema.Finite })])
export type Admission = typeof Admission.Type

/** The workflow event that tells a waiting audit an engine was handed to it. */
export const ENGINE_FREE_EVENT = "engine-free"

/**
 * Hands the capture engines out one capture at a time, first come first served. An audit asks
 * before each capture, naming the turn, and joins the back of the line; asking for a new turn
 * drops any grant the audit failed to release for an earlier one; the capture confirms its grant before it
 * touches the engine, and releases it as soon as the capture is stored or has failed.
 */
export class CaptureAdmission extends Context.Service<
  CaptureAdmission,
  {
    readonly admit: (auditId: string, turn: string) => Effect.Effect<Admission, AdmissionError>
    /** Whether `grant` still holds its engine; renews it when it does. */
    readonly confirm: (auditId: string, grant: Grant) => Effect.Effect<boolean, AdmissionError>
    readonly release: (auditId: string, grant: Grant) => Effect.Effect<void, AdmissionError>
  }
>()("@repo/core/CaptureAdmission") {}
