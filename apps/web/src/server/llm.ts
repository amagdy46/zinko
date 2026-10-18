import { Auth } from "@repo/core/Auth"
import { Llm, LlmError, LlmNotConfigured, type LlmProvider, llmProviders } from "@repo/core/llm"
import { decryptSecret, encryptSecret, loadEncryptionKey } from "@repo/core/llm-crypto"
import { LlmCredentialStore } from "@repo/core/llm-store"
import { DatabaseLayer } from "@repo/db"
import { Config, Context, Effect, Layer, Option, Redacted } from "effect"
import { WorkerConfig } from "effect-cf"
import { AuthLive } from "./auth-live"
import { WorkerEnvLive } from "./cloudflare"
import { generateWith, type LlmSettings } from "./llm-provider"
import { LlmCredentialStoreLive } from "./llm-store"

/** What the settings page may see: never the key, only its last four characters. */
export interface LlmCredentialSummary {
  readonly provider: LlmProvider
  readonly model: string
  readonly baseUrl: string | null
  readonly last4: string
}

export interface LlmCredentialInput {
  readonly provider: LlmProvider
  readonly model: string
  /** Leave out to keep the stored key (same provider only). */
  readonly apiKey: string | undefined
  readonly baseUrl: string | null
}

const isProvider = (value: string): value is LlmProvider =>
  llmProviders.some((provider) => provider === value)

/** Per-organization model settings with the key encrypted at rest. */
export class LlmCredentials extends Context.Service<
  LlmCredentials,
  {
    readonly summary: (
      orgId: string,
    ) => Effect.Effect<Option.Option<LlmCredentialSummary>, LlmError>
    readonly save: (
      orgId: string,
      input: LlmCredentialInput,
    ) => Effect.Effect<void, LlmError | LlmNotConfigured>
    readonly clear: (orgId: string) => Effect.Effect<void, LlmError>
    /** The decrypted settings, for making a request. */
    readonly resolve: (orgId: string) => Effect.Effect<LlmSettings, LlmError | LlmNotConfigured>
  }
>()("LlmCredentials") {}

const none = () =>
  new LlmNotConfigured({
    message: "No API key is set for this organization. Add one in Settings > AI.",
  })

const LlmCredentialsLive = Layer.effect(
  LlmCredentials,
  Effect.gen(function* () {
    const store = yield* LlmCredentialStore
    const provider = yield* WorkerConfig.provider
    // built with the layer: a missing or malformed LLM_ENCRYPTION_KEY stops the app at startup
    const key = yield* loadEncryptionKey(
      Option.getOrUndefined(
        yield* Config.option(Config.String("LLM_ENCRYPTION_KEY")).parse(provider),
      ),
    )

    const open = (row: { orgId: string; encryptedKey: string }) =>
      decryptSecret(key, row.encryptedKey, row.orgId)

    return LlmCredentials.of({
      summary: (orgId) =>
        Effect.gen(function* () {
          const found = yield* store.find(orgId)
          if (Option.isNone(found) || !isProvider(found.value.provider)) return Option.none()
          const apiKey = yield* open(found.value)
          return Option.some({
            provider: found.value.provider,
            model: found.value.model,
            baseUrl: found.value.baseUrl,
            last4: apiKey.slice(-4),
          })
        }),
      save: (orgId, input) =>
        Effect.gen(function* () {
          const existing = yield* store.find(orgId)
          const keep =
            input.apiKey === undefined &&
            Option.isSome(existing) &&
            existing.value.provider === input.provider
          if (input.apiKey === undefined && input.provider !== "ollama" && !keep)
            return yield* new LlmNotConfigured({ message: "Enter an API key." })
          const encryptedKey =
            keep && Option.isSome(existing)
              ? existing.value.encryptedKey
              : yield* encryptSecret(key, input.apiKey ?? "", orgId)
          return yield* store.upsert({
            orgId,
            provider: input.provider,
            model: input.model,
            encryptedKey,
            baseUrl: input.baseUrl,
          })
        }),
      clear: (orgId) => store.remove(orgId),
      resolve: (orgId) =>
        Effect.gen(function* () {
          const found = yield* store.find(orgId)
          if (Option.isNone(found) || !isProvider(found.value.provider)) return yield* none()
          const apiKey = yield* open(found.value)
          return {
            provider: found.value.provider,
            model: found.value.model,
            apiKey: apiKey === "" ? undefined : Redacted.make(apiKey),
            baseUrl: found.value.baseUrl ?? undefined,
          }
        }),
    })
  }),
).pipe(
  Layer.provide(LlmCredentialStoreLive),
  Layer.provide(DatabaseLayer),
  Layer.provide(WorkerEnvLive),
)

/**
 * `Llm` using the key the current organization saved in Settings > AI. Provides `LlmCredentials`
 * too (the settings server functions use it). Needs `Auth` to know whose organization is calling.
 */
export const LlmLive = Layer.effect(
  Llm,
  Effect.gen(function* () {
    const auth = yield* Auth
    const credentials = yield* LlmCredentials
    return Llm.of({
      generateText: (prompt) =>
        Effect.gen(function* () {
          const session = yield* auth.currentSession.pipe(
            Effect.mapError(() => new LlmNotConfigured({ message: "Sign in to use AI." })),
          )
          if (session.activeOrganizationId === null)
            return yield* new LlmNotConfigured({ message: "Select an organization first." })
          const settings = yield* credentials.resolve(session.activeOrganizationId)
          return yield* generateWith(settings, prompt)
        }),
    })
  }),
).pipe(Layer.provideMerge(LlmCredentialsLive), Layer.provide(AuthLive))
