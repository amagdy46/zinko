import { Context, Data, Effect } from "effect"

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

/** Each provider attempt is cut off after this long; the interrupted request is cancelled, not abandoned. */
export const EXPLAIN_ATTEMPT_TIMEOUT_MS = 60_000

/** Which configuration answers a call. Nothing secret: the endpoint is a hash, never the key or the URL. */
export interface LlmIdentity {
  readonly provider: LlmProvider
  readonly model: string
  readonly endpointId: string
}

/**
 * A model configuration resolved once for one organization. `identity` and `generateText` come from
 * the same settings, so a settings change or an organization switch while a call is pending cannot
 * make the answer belong to a different configuration than the one it is stored under.
 */
export interface LlmModel {
  readonly identity: LlmIdentity
  /** One provider attempt, bounded by `EXPLAIN_ATTEMPT_TIMEOUT_MS`. */
  readonly generateText: (prompt: string) => Effect.Effect<string, LlmError>
}

/** First 16 hex digits of sha256 over the provider and the normalized endpoint URL (empty for a provider's default). */
export const endpointId = (provider: LlmProvider, baseUrl: string): Effect.Effect<string> =>
  Effect.promise(async () => {
    const normalized = baseUrl.trim().replace(/\/+$/, "")
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${provider}\n${normalized}`),
    )
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 16)
  })

/**
 * Text generation. The implementation in `apps/web/src/server/llm.ts` decides where the provider,
 * model and key come from; app code asks for the organization's model once and calls it.
 */
export class Llm extends Context.Service<
  Llm,
  {
    /** Resolves the settings of an organization the caller has already checked membership for. */
    readonly forOrganization: (
      orgId: string,
    ) => Effect.Effect<LlmModel, LlmError | LlmNotConfigured>
  }
>()("@repo/core/Llm") {}
