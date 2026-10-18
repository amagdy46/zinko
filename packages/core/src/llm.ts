import { Context, Data, type Effect } from "effect"

/** Providers `makeLlmLayer` can talk to. Ollama goes through the OpenAI-compatible client. */
export const llmProviders = ["anthropic", "openai", "openrouter", "ollama"] as const
export type LlmProvider = (typeof llmProviders)[number]

/** A provider request, or the storage around it, failed. */
export class LlmError extends Data.TaggedError("LlmError")<{
  readonly operation: string
  readonly cause: unknown
}> {
  override get message(): string {
    const cause = this.cause instanceof Error ? `: ${this.cause.message}` : ""
    return `LLM ${this.operation} failed${cause}`
  }
}

/** There is no usable model configuration for this call (no key set, or no organization selected). */
export class LlmNotConfigured extends Data.TaggedError("LlmNotConfigured")<{
  readonly message: string
}> {}

/**
 * Text generation. The implementation in `apps/web/src/server/llm.ts` decides where the provider,
 * model and key come from; app code only calls `generateText`.
 */
export class Llm extends Context.Service<
  Llm,
  {
    readonly generateText: (prompt: string) => Effect.Effect<string, LlmError | LlmNotConfigured>
  }
>()("@repo/core/Llm") {}
