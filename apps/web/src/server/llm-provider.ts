import { AnthropicClient, AnthropicLanguageModel } from "@effect/ai-anthropic"
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai"
import { OpenRouterClient, OpenRouterLanguageModel } from "@effect/ai-openrouter"
import { LlmError, type LlmProvider } from "@repo/core/llm"
import { Effect, Layer, type Redacted } from "effect"
import { LanguageModel } from "effect/ai"
import { FetchHttpClient, type HttpClient } from "effect/http"

export interface LlmSettings {
  readonly provider: LlmProvider
  /** Not needed for a local Ollama. */
  readonly apiKey: Redacted.Redacted | undefined
  readonly model: string
  /** OpenAI-compatible endpoint (`openai`, `ollama`); other providers ignore it. */
  readonly baseUrl?: string | undefined
}

/** Where Ollama listens by default; it speaks the OpenAI API under `/v1`. */
export const OLLAMA_URL = "http://localhost:11434/v1"

type ProviderLayer = Layer.Layer<LanguageModel.LanguageModel, never, HttpClient.HttpClient>

/** One entry per provider: the model layer on top of that provider's client. */
const providerLayers: Record<LlmProvider, (settings: LlmSettings) => ProviderLayer> = {
  anthropic: ({ apiKey, model }) =>
    AnthropicLanguageModel.layer({ model }).pipe(Layer.provide(AnthropicClient.layer({ apiKey }))),
  openrouter: ({ apiKey, model }) =>
    OpenRouterLanguageModel.layer({ model }).pipe(
      Layer.provide(OpenRouterClient.layer({ apiKey })),
    ),
  openai: ({ apiKey, model, baseUrl }) =>
    OpenAiLanguageModel.layer({ model }).pipe(
      Layer.provide(OpenAiClient.layer({ apiKey, apiUrl: baseUrl })),
    ),
  ollama: ({ apiKey, model, baseUrl }) =>
    OpenAiLanguageModel.layer({ model }).pipe(
      Layer.provide(OpenAiClient.layer({ apiKey, apiUrl: baseUrl ?? OLLAMA_URL })),
    ),
}

/**
 * The `LanguageModel` for `{ provider, apiKey, model, baseUrl }`. Switching provider changes this
 * layer and nothing else: app code calls `LanguageModel.generateText` (or the `Llm` service) either way.
 */
export const makeLlmLayer = (settings: LlmSettings): Layer.Layer<LanguageModel.LanguageModel> =>
  providerLayers[settings.provider](settings).pipe(Layer.provide(FetchHttpClient.layer))

/** One `generateText` call against `settings`. */
export const generateWith = (settings: LlmSettings, prompt: string) =>
  LanguageModel.generateText({ prompt }).pipe(
    Effect.map((response) => response.text),
    // the layer depends on this call's settings, so it is built here rather than at an entry point
    // oxlint-disable-next-line effecttsgo/strict-effect-provide
    Effect.provide(makeLlmLayer(settings)),
    Effect.mapError((cause) => new LlmError({ operation: "generateText", cause })),
  )
