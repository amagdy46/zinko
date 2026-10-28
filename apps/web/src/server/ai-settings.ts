import type { Session } from "@repo/core/Auth"
import { Llm, LlmNotConfigured, llmProviders } from "@repo/core/llm"
import { createServerFn } from "@tanstack/react-start"
import { Effect, Option, Schema } from "effect"
import { LlmCredentials } from "./llm"
import { requireSession } from "./require-session"
import { Forbidden, Invalid, isManager, membership, mutation, read } from "./server-fn"

/** The active organization and whether the caller may change its AI settings, read from one membership lookup. */
const manager = (session: Session) =>
  Effect.gen(function* () {
    const { organizationId, role } = yield* membership(session)
    if (!isManager(role))
      return yield* new Forbidden({
        message: "Only organization owners and admins can change AI settings.",
      })
    return organizationId
  })

/** User-facing failure: the message, never the cause (which may carry request details). */
const report = <A, R>(effect: Effect.Effect<A, { readonly message: string }, R>) =>
  effect.pipe(Effect.mapError((error) => new Invalid({ message: error.message })))

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
export const getLlmSettings = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .handler(({ context }) =>
    read(
      Effect.gen(function* () {
        const { organizationId, role } = yield* membership(context.session)
        const canManage = isManager(role)
        const credentials = yield* LlmCredentials
        const summary = Option.getOrNull(yield* credentials.summary(organizationId))
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
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(SaveInput))
  .handler(({ context, data }) =>
    mutation(
      report(
        Effect.gen(function* () {
          const orgId = yield* manager(context.session)
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

export const clearLlmSettings = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .handler(({ context }) =>
    mutation(
      report(
        Effect.gen(function* () {
          const orgId = yield* manager(context.session)
          yield* (yield* LlmCredentials).clear(orgId)
        }),
      ),
    ),
  )

/** Sends a one-word prompt with the saved key to check that it works. */
export const testLlmSettings = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .handler(({ context }) =>
    mutation(
      report(
        Effect.gen(function* () {
          const orgId = yield* manager(context.session)
          const model = yield* (yield* Llm).forOrganization(orgId)
          return (yield* model.generateText("Reply with the single word: ok")).slice(0, 200)
        }),
      ),
    ),
  )
