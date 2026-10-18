import { Auth, Unauthorized } from "@repo/core/Auth"
import { getRequestHeaders } from "@tanstack/react-start/server"
import { Config, Context, Effect, Layer, Option, Redacted } from "effect"
import { WorkerConfig } from "effect-cf"
import { type AuthInstance, makeAuth } from "./auth"
import { AuthDatabase, AuthDatabaseLayer } from "./auth-database"
import { WorkerEnvLive } from "./cloudflare"

/** The Better Auth instance; `/api/auth/*` is served from it (see auth-route.ts). */
export class BetterAuth extends Context.Service<BetterAuth, AuthInstance>()("BetterAuth") {}

const BetterAuthLive = Layer.effect(
  BetterAuth,
  Effect.gen(function* () {
    const { database } = yield* AuthDatabase
    const provider = yield* WorkerConfig.provider
    const { secret, baseURL } = yield* Effect.all({
      secret: Config.Redacted("BETTER_AUTH_SECRET").parse(provider),
      baseURL: Config.option(Config.String("BETTER_AUTH_URL")).parse(provider),
    })
    return makeAuth({
      database,
      secret: Redacted.value(secret),
      baseURL: Option.getOrUndefined(Option.filter(baseURL, (url) => url !== "")),
    })
  }),
).pipe(Layer.provide(AuthDatabaseLayer), Layer.provide(WorkerEnvLive))

const unauthorized = () => new Unauthorized({ message: "Not signed in" })

/** Provides `Auth` (and `BetterAuth`). The session is read from the cookies of the request being handled. */
export const AuthLive = Layer.effect(
  Auth,
  Effect.gen(function* () {
    const auth = yield* BetterAuth
    return Auth.of({
      currentSession: Effect.gen(function* () {
        const found = yield* Effect.tryPromise({
          try: () => auth.api.getSession({ headers: getRequestHeaders() }),
          catch: unauthorized,
        })
        if (found === null) return yield* unauthorized()
        return {
          userId: found.user.id,
          email: found.user.email,
          name: found.user.name,
          activeOrganizationId: found.session.activeOrganizationId ?? null,
        }
      }),
    })
  }),
).pipe(Layer.provideMerge(BetterAuthLive))
