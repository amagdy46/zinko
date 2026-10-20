import { Context, Data, type Effect, Schema } from "effect"

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
