import { CaptureRejected, CaptureResult } from "@repo/capture-contract"
import { Browser, BrowserError } from "@repo/core"
import { Effect, Layer, Schema } from "effect"
import { ContainerNamespace } from "effect-cf"
import { WorkerEnvLive } from "./cloudflare"

class BrowserNamespace extends ContainerNamespace.Tag<BrowserNamespace>()("BrowserNamespace") {}

// The result carries the screenshot as base64 for M1 only. In M2 the workflow step stores it
// through `Storage` and returns a key instead, because Workflow step results are capped at 1 MiB.
const decodeResult = Schema.decodeUnknownEffect(CaptureResult)
const decodeRejected = Schema.decodeUnknownEffect(CaptureRejected)

const fail = (cause: unknown) => new BrowserError({ operation: "capture", cause })

const make = Effect.gen(function* () {
  const containers = yield* BrowserNamespace
  return Browser.of({
    capture: (request) =>
      Effect.gen(function* () {
        // one shared instance; use a different name per tenant or job to run containers in parallel
        const response = yield* containers
          .byName("default")
          .fetch("http://container/capture", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(request),
          })
          .pipe(Effect.mapError(fail))
        if (response.status !== 200 && response.status !== 400) {
          return yield* fail(`container responded ${response.status}`)
        }
        const body = yield* Effect.tryPromise({ try: () => response.json(), catch: fail })
        if (response.status === 400) {
          const rejected = yield* decodeRejected(body).pipe(Effect.mapError(fail))
          return yield* new BrowserError({ operation: "capture", cause: rejected, rejected })
        }
        return yield* decodeResult(body).pipe(Effect.mapError(fail))
      }),
  })
})

/** `Browser` on the BROWSER container binding. */
export const BrowserLive = Layer.effect(Browser, make).pipe(
  Layer.provide(BrowserNamespace.layer({ binding: "BROWSER" })),
  Layer.provide(WorkerEnvLive),
)
