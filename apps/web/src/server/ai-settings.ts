import { Auth } from "@repo/core/Auth"
import { Llm, LlmNotConfigured, llmProviders } from "@repo/core/llm"
import { createServerFn } from "@tanstack/react-start"
import { getRequestHeaders } from "@tanstack/react-start/server"
import { Data, Effect, Option, Schema } from "effect"
import { BetterAuth } from "./auth-live"
import { LlmCredentials } from "./llm"
import { runtime } from "./runtime"

class Forbidden extends Data.TaggedError("Forbidden")<{ readonly message: string }> {}

/** The signed-in user's active organization and whether they may change its AI settings (owner or admin). */
const currentOrganization = Effect.gen(function* () {
  const auth = yield* Auth
  const session = yield* auth.currentSession
  const orgId = session.activeOrganizationId
  if (orgId === null)
    return yield* new LlmNotConfigured({ message: "Select an organization first." })
  const betterAuth = yield* BetterAuth
  const member = yield* Effect.promise(() =>
    betterAuth.api.getActiveMember({ headers: getRequestHeaders() }),
  )
  const roles = member?.role.split(",") ?? []
  return { orgId, canManage: roles.includes("owner") || roles.includes("admin") }
})

const manager = Effect.gen(function* () {
  const org = yield* currentOrganization
  if (!org.canManage)
    return yield* new Forbidden({
      message: "Only organization owners and admins can change AI settings.",
    })
  return org.orgId
})

/** User-facing failure: the message, never the cause (which may carry request details). */
const report = <A, R>(effect: Effect.Effect<A, { readonly message: string }, R>) =>
  effect.pipe(
    Effect.map((value) => ({ ok: true as const, value })),
    Effect.catch((error) => Effect.succeed({ ok: false as const, message: error.message })),
  )

const baseUrlField = Schema.String.check(Schema.isMaxLength(2048))

const SaveInput = Schema.Struct({
  provider: Schema.Literals(llmProviders),
  model: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  apiKey: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(1000))),
  baseUrl: Schema.optionalKey(baseUrlField),
})

/** Only OpenAI-compatible providers take a custom endpoint, and it must be an http(s) URL. */
const parseBaseUrl = (provider: string, value: string | undefined) =>
  Effect.gen(function* () {
    const text = value?.trim() ?? ""
    if (text === "" || (provider !== "openai" && provider !== "ollama")) return null
    const url = yield* Effect.try({
      try: () => new URL(text),
      catch: () => new LlmNotConfigured({ message: "Base URL must be a valid URL." }),
    })
    if (url.protocol !== "https:" && url.protocol !== "http:")
      return yield* new LlmNotConfigured({
        message: "Base URL must start with http:// or https://.",
      })
    return url.toString()
  })

/** This organization's AI settings. The key never leaves the server: only its last four characters do (to managers). */
export const getLlmSettings = createServerFn({ method: "GET" }).handler(() =>
  runtime.runPromise(
    Effect.gen(function* () {
      const { orgId, canManage } = yield* currentOrganization
      const credentials = yield* LlmCredentials
      const summary = Option.getOrNull(yield* credentials.summary(orgId))
      return {
        canManage,
        configured: summary !== null,
        provider: summary?.provider ?? null,
        model: summary?.model ?? null,
        baseUrl: summary?.baseUrl ?? null,
        last4: canManage ? (summary?.last4 ?? null) : null,
      }
    }).pipe(Effect.orElseSucceed(() => null)),
  ),
)

export const saveLlmSettings = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(SaveInput))
  .handler(({ data }) =>
    runtime.runPromise(
      report(
        Effect.gen(function* () {
          const orgId = yield* manager
          const credentials = yield* LlmCredentials
          const apiKey = data.apiKey?.trim()
          yield* credentials.save(orgId, {
            provider: data.provider,
            model: data.model.trim(),
            apiKey: apiKey === "" ? undefined : apiKey,
            baseUrl: yield* parseBaseUrl(data.provider, data.baseUrl),
          })
        }),
      ),
    ),
  )

export const clearLlmSettings = createServerFn({ method: "POST" }).handler(() =>
  runtime.runPromise(
    report(
      Effect.gen(function* () {
        const orgId = yield* manager
        yield* (yield* LlmCredentials).clear(orgId)
      }),
    ),
  ),
)

/** Sends a one-word prompt with the saved key to check that it works. */
export const testLlmSettings = createServerFn({ method: "POST" }).handler(() =>
  runtime.runPromise(
    report(
      Effect.gen(function* () {
        yield* manager
        const llm = yield* Llm
        return (yield* llm.generateText("Reply with the single word: ok")).slice(0, 200)
      }),
    ),
  ),
)
