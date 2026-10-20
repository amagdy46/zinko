import { JobError, type JobName, type JobPayloads, Jobs } from "@repo/core"
import { Effect, Layer, Option, type Schema } from "effect"
import type { Workflow } from "effect-cf"
import { AuditWorkflow } from "../workflows/AuditWorkflow"
import { ExampleWorkflow } from "../workflows/Example"
import { WorkerEnvLive } from "./cloudflare"

const fail = (operation: string) => (cause: unknown) => new JobError({ operation, cause })

const make = Effect.gen(function* () {
  // one entry per workflow; keys match `JobPayloads` in @repo/core
  const example = yield* ExampleWorkflow
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
  } = { example, audit }
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
  })
})

/** `Jobs` on Cloudflare Workflows, through the EXAMPLE_WORKFLOW and AUDIT_WORKFLOW bindings. */
export const JobsLive = Layer.effect(Jobs, make).pipe(
  Layer.provide(ExampleWorkflow.layer({ binding: "EXAMPLE_WORKFLOW" })),
  Layer.provide(AuditWorkflow.layer({ binding: "AUDIT_WORKFLOW" })),
  Layer.provide(WorkerEnvLive),
)
