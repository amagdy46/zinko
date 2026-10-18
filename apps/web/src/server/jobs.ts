import { JobError, Jobs } from "@repo/core"
import { Effect, Layer, Option } from "effect"
import { ExampleWorkflow } from "../workflows/Example"
import { WorkerEnvLive } from "./cloudflare"

const fail = (operation: string) => (cause: unknown) => new JobError({ operation, cause })

const make = Effect.gen(function* () {
  // one entry per workflow; keys match `JobPayloads` in @repo/core
  const workflows = { example: yield* ExampleWorkflow }
  return Jobs.of({
    start: (job, payload) =>
      workflows[job].create(payload).pipe(
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

/** `Jobs` on Cloudflare Workflows, through the EXAMPLE_WORKFLOW binding. */
export const JobsLive = Layer.effect(Jobs, make).pipe(
  Layer.provide(ExampleWorkflow.layer({ binding: "EXAMPLE_WORKFLOW" })),
  Layer.provide(WorkerEnvLive),
)
