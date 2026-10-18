import { Llm } from "@repo/core/llm"
import { createServerFn } from "@tanstack/react-start"
import { Effect, Schema } from "effect"
import { requireSession } from "./require-session"
import { runtime } from "./runtime"

const GenerateInput = Schema.Struct({
  prompt: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4000)),
})

/**
 * Demo: sends `prompt` to the configured model and returns its text, or a message saying why not.
 * Gated by `requireSession` when the project has auth. Call it from a component or a loader.
 */
export const generateText = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(GenerateInput))
  .handler(({ data }) =>
    runtime.runPromise(
      Effect.gen(function* () {
        const llm = yield* Llm
        return { ok: true as const, text: yield* llm.generateText(data.prompt) }
      }).pipe(
        Effect.catch((error) => Effect.succeed({ ok: false as const, message: error.message })),
      ),
    ),
  )
