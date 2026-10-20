import { CaptureRejected, CaptureResult } from "@repo/capture-contract"
import { Browser, BrowserError } from "@repo/core"
import { Config, Effect, Layer, Option, Schema } from "effect"
import { ContainerNamespace, WorkerConfig } from "effect-cf"
import { WorkerEnvLive } from "./cloudflare"

class BrowserNamespace extends ContainerNamespace.Tag<BrowserNamespace>()("BrowserNamespace") {}

// The result carries the screenshot as base64 for M1 only. In M2 the workflow step stores it
// through `Storage` and returns a key instead, because Workflow step results are capped at 1 MiB.
const decodeResult = Schema.decodeUnknownEffect(CaptureResult)
const decodeRejected = Schema.decodeUnknownEffect(CaptureRejected)

const fail = (cause: unknown, status?: number) =>
  new BrowserError({ operation: "capture", cause, ...(status === undefined ? {} : { status }) })

// The Containers runtime answers 503 when no instance is free (over `maxInstances`) and 500 with
// this prefix when it cannot start one; both mean "try again later", so both are reported as 503.
const START_FAILURE = "Failed to start container"

/** Turns the engine's HTTP answer into a `CaptureResult` or a `BrowserError`. */
const interpret = (response: Response) =>
  Effect.gen(function* () {
    if (response.status !== 200 && response.status !== 400) {
      const text = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: (e) => fail(e, response.status),
      })
      const status =
        response.status === 500 && text.startsWith(START_FAILURE) ? 503 : response.status
      return yield* fail(`engine responded ${response.status}: ${text.slice(0, 200)}`, status)
    }
    const body = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: (e) => fail(e, response.status),
    })
    if (response.status === 400) {
      const rejected = yield* decodeRejected(body).pipe(
        Effect.mapError((cause) => fail(cause, 400)),
      )
      return yield* new BrowserError({
        operation: "capture",
        cause: rejected,
        rejected,
        status: 400,
      })
    }
    return yield* decodeResult(body).pipe(Effect.mapError((cause) => fail(cause, 200)))
  })

const post = (request: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(request),
})

const ContainerBrowser = Layer.effect(
  Browser,
  Effect.gen(function* () {
    const containers = yield* BrowserNamespace
    return Browser.of({
      // each instance name is its own container, so jobs can run in parallel
      capture: (request, options) =>
        containers
          .byName(options?.instance ?? "default")
          .fetch("http://container/capture", post(request))
          .pipe(
            Effect.mapError((cause) => fail(cause)),
            Effect.flatMap(interpret),
          ),
    })
  }),
).pipe(Layer.provide(BrowserNamespace.layer({ binding: "BROWSER" })))

/** An engine started by hand (`BROWSER_URL`, dev stages only); every instance name shares it. */
const HttpBrowser = (baseUrl: string) =>
  Layer.succeed(
    Browser,
    Browser.of({
      capture: (request) =>
        Effect.tryPromise({
          try: () => fetch(`${baseUrl.replace(/\/+$/, "")}/capture`, post(request)),
          catch: (cause) => fail(cause),
        }).pipe(Effect.flatMap(interpret)),
    }),
  )

/**
 * `Browser`: the engine at `BROWSER_URL` when it is set (infra/alchemy.run.ts passes it to the
 * Worker on `dev` stages only), otherwise the BROWSER container binding.
 */
export const BrowserLive = Layer.unwrap(
  Effect.gen(function* () {
    const provider = yield* WorkerConfig.provider
    const url = yield* Config.option(Config.String("BROWSER_URL")).parse(provider)
    return Option.isSome(url) && url.value !== "" ? HttpBrowser(url.value) : ContainerBrowser
  }),
).pipe(Layer.provide(WorkerEnvLive))
