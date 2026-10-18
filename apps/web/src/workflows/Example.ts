import { Data, Effect, Layer, Schema } from "effect"
import { Workflow } from "effect-cf"

/** A typed failure: the name is unusable, so retrying cannot help. */
export class InvalidName extends Data.TaggedError("InvalidName")<{ readonly input: string }> {}

export class ExampleWorkflow extends Workflow.Tag<ExampleWorkflow>()("ExampleWorkflow", {
  payload: Schema.Struct({ name: Schema.String }),
  result: Schema.Struct({ message: Schema.String }),
}) {}

/**
 * A Cloudflare Workflow: each `Workflow.step` is durable, retried on failure, and not re-run once
 * it has succeeded. Bound as EXAMPLE_WORKFLOW in wrangler.jsonc and exported from `src/server.ts`.
 */
export class Example extends ExampleWorkflow.make(Layer.empty, {
  run: ({ name }) =>
    Effect.gen(function* () {
      // Failing with WorkflowStepNonRetryableError ends the workflow at once; any other failure
      // is retried up to `limit` times with exponential backoff (2s, 4s, 8s), then fails the run.
      const greeting = yield* Workflow.step(
        "greet",
        name.trim() === ""
          ? Effect.fail(
              new Workflow.WorkflowStepNonRetryableError({
                cause: new InvalidName({ input: name }),
              }),
            )
          : Effect.succeed(`Hello, ${name.trim()}`),
        {
          retries: { limit: 3, delay: "2 seconds", backoff: "exponential" },
          timeout: "30 seconds",
        },
      )
      yield* Workflow.sleep("pause", "5 seconds")
      const message = yield* Workflow.step(
        "finish",
        Effect.sync(() => `${greeting}! The workflow finished.`),
      )
      return { message }
    }),
}) {}
