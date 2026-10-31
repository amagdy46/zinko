import { JobError, type JobName, type JobPayloads, Jobs } from "@repo/core"
import { Effect, Layer, Option, type Schema } from "effect"
import type { Workflow } from "effect-cf"
import { AuditWorkflow } from "../workflows/AuditWorkflow"
import { WorkerEnvLive } from "./cloudflare"

const fail = (operation: string) => (cause: unknown) => new JobError({ operation, cause })

const make = Effect.gen(function* () {
  // one entry per workflow; keys match `JobPayloads` in @repo/core
  const audit = yield* AuditWorkflow
  const workflows: {
    readonly [N in JobName]: {
      readonly create: (
        payload: JobPayloads[N],
        options: { readonly id: string } | undefined,
      ) => Effect.Effect<
        Workflow.WorkflowInstance<unknown>,
        Workflow.WorkflowOperationError | Schema.SchemaError
      >
      readonly get: (
        id: string,
      ) => Effect.Effect<Workflow.WorkflowInstance<unknown>, Workflow.WorkflowOperationError>
    }
  } = { audit }
  return Jobs.of({
    start: (job, payload, options) =>
      workflows[job]
        .create(payload, options?.id === undefined ? undefined : { id: options.id })
        .pipe(
          Effect.map((instance) => ({ id: instance.id })),
          Effect.mapError(fail("start")),
        ),
    status: (job, id) =>
      workflows[job].get(id).pipe(
        Effect.flatMap((instance) => instance.status),
        Effect.map((s) => ({
          status: s.status,
          output: Option.getOrUndefined(s.output),
          error: Option.getOrUndefined(Option.map(s.error, (e) => e.message)),
        })),
        Effect.mapError(fail("status")),
      ),
    terminate: (job, id) =>
      workflows[job].get(id).pipe(
        Effect.flatMap((instance) => instance.terminate()),
        Effect.mapError(fail("terminate")),
      ),
    sendEvent: (job, id, type) =>
      workflows[job].get(id).pipe(
        Effect.flatMap((instance) => instance.sendEvent({ type, payload: null })),
        Effect.mapError(fail("sendEvent")),
      ),
  })
})

/** `Jobs` on Cloudflare Workflows, through the AUDIT_WORKFLOW binding. */
export const JobsLive = Layer.effect(Jobs, make).pipe(
  Layer.provide(AuditWorkflow.layer({ binding: "AUDIT_WORKFLOW" })),
  Layer.provide(WorkerEnvLive),
)
