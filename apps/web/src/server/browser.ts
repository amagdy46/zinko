import { Browser, BrowserError } from "@repo/core"
import { Effect, Layer, Schema } from "effect"
import { ContainerNamespace } from "effect-cf"
import { WorkerEnvLive } from "./cloudflare"

class BrowserNamespace extends ContainerNamespace.Tag<BrowserNamespace>()("BrowserNamespace") {}

const RunResult = Schema.Struct({ title: Schema.String, requests: Schema.Finite })
const decode = Schema.decodeUnknownEffect(RunResult)

const fail = (operation: string) => (cause: unknown) => new BrowserError({ operation, cause })

const make = Effect.gen(function* () {
  const containers = yield* BrowserNamespace
  return Browser.of({
    run: (url) =>
      Effect.gen(function* () {
        // one shared instance; use a different name per tenant or job to run containers in parallel
        const response = yield* containers.byName("default").fetch("http://container/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url }),
        })
        if (!response.ok) return yield* Effect.fail(`container responded ${response.status}`)
        return yield* decode(yield* Effect.promise(() => response.json()))
      }).pipe(Effect.mapError(fail("run"))),
  })
})

/** `Browser` on the BROWSER container binding. */
export const BrowserLive = Layer.effect(Browser, make).pipe(
  Layer.provide(BrowserNamespace.layer({ binding: "BROWSER" })),
  Layer.provide(WorkerEnvLive),
)
