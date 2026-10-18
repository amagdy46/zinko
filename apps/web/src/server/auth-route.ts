import { Effect } from "effect"
import { BetterAuth } from "./auth-live"
import type { WorkerRoute } from "./routes"
import { runtime } from "./runtime"

/** Serves Better Auth's HTTP API under `/api/auth/*` (sign-in, sign-up, sessions, organizations). */
export const authRoute: WorkerRoute = async (request) => {
  if (!new URL(request.url).pathname.startsWith("/api/auth/")) return undefined
  return runtime.runPromise(
    Effect.gen(function* () {
      const auth = yield* BetterAuth
      return yield* Effect.promise(() => auth.handler(request))
    }),
  )
}
