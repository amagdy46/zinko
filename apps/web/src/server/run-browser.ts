import { CaptureRequest } from "@repo/capture-contract"
import { Browser } from "@repo/core"
import { createServerFn } from "@tanstack/react-start"
import { Effect, Schema } from "effect"
import { requireSession } from "./require-session"
import { runtime } from "./runtime"

/**
 * Captures one page under one consent scenario in the browser container and returns the
 * `CaptureResult`. The container refuses private and local addresses (see
 * apps/browser/src/server.ts). With an auth add-on this function is gated by `requireSession`;
 * without one, add your own check before exposing it to anonymous users.
 */
export const runBrowser = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(CaptureRequest))
  .handler(({ data }) =>
    runtime.runPromise(
      Effect.gen(function* () {
        const browser = yield* Browser
        return yield* browser.capture(data)
      }),
    ),
  )
