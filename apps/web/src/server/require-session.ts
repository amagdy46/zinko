import { Auth } from "@repo/core/Auth"
import { createMiddleware } from "@tanstack/react-start"
import { Effect } from "effect"
import { runtime } from "./runtime"

/**
 * Server-function middleware: rejects the call unless someone is signed in. Add it with
 * `createServerFn(...).middleware([requireSession])`; `efforge` extras (browser, workflows, AI)
 * are wired this way when the project has auth. The session is also passed on as `context.session`.
 */
export const requireSession = createMiddleware({ type: "function" }).server(({ next }) =>
  runtime
    .runPromise(
      Effect.gen(function* () {
        const auth = yield* Auth
        return yield* auth.currentSession
      }),
    )
    .then((session) => next({ context: { session } })),
)
