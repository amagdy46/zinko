import { createServer } from "node:http"
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { Data, Effect, Layer } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { runCapture } from "./capture.ts"
import { CaptureRequest, type CaptureRejected } from "./contract.ts"
import { checkUrl, resolveHost } from "./url-policy.ts"

/*
 * SECURITY (SSRF): this server loads any URL it is sent, from inside your network. The start URL
 * is checked here, and every connection the browser opens afterwards (subresources, redirects,
 * journey steps) goes through the egress proxy in ./egress-proxy.ts, which applies the same
 * policy from ./url-policy.ts after resolving the name. By default that refuses localhost and
 * private, loopback and link-local addresses, such as the 169.254.169.254 metadata endpoint.
 * ALLOW_PRIVATE_NETWORKS=true turns those checks off: only set it for local development against
 * the fixtures, never in the image or a deployed container.
 */
const allowPrivate = process.env.ALLOW_PRIVATE_NETWORKS === "true"
/** `playwright` skips Scrapling, for when a Scrapling or patchright upgrade misbehaves. */
const engine = process.env.CAPTURE_ENGINE === "playwright" ? "playwright" : "scrapling"

const rejected = (status: number, body: CaptureRejected | { error: "Busy"; message: string }) =>
  HttpServerResponse.json(body, { status }).pipe(Effect.orDie)

/** The body is not a `CaptureRequest`. */
class InvalidRequest extends Data.TaggedError("InvalidRequest")<{ readonly message: string }> {}

/** A URL in the request fails the URL policy. */
class PolicyDenied extends Data.TaggedError("PolicyDenied")<{ readonly message: string }> {}

/** The start URL must pass the policy after DNS; journey URLs are checked by text here and by the proxy later. */
const policyProblem = async (request: CaptureRequest): Promise<string | undefined> => {
  const start = checkUrl(request.url, allowPrivate)
  if (!start.ok) return `${request.url}: ${start.reason}`
  const resolved = await resolveHost(start.url.hostname, allowPrivate)
  if (!resolved.ok) return `${request.url}: ${resolved.reason}`
  for (const step of request.journey ?? []) {
    if (step.action !== "goto") continue
    const checked = checkUrl(step.url, allowPrivate)
    if (!checked.ok) return `${step.url}: ${checked.reason}`
  }
  return undefined
}

let busy = false

const capture = HttpRouter.add(
  "POST",
  "/capture",
  Effect.gen(function* () {
    if (busy)
      return yield* rejected(429, { error: "Busy", message: "a capture is already running" })
    busy = true
    let running: Promise<unknown> | undefined
    // Released when the capture ends, even if the client hung up before that.
    const release = Effect.promise(() => running ?? Promise.resolve()).pipe(
      Effect.andThen(
        Effect.sync(() => {
          busy = false
        }),
      ),
    )
    return yield* Effect.gen(function* () {
      const request = yield* HttpServerRequest.schemaBodyJson(CaptureRequest).pipe(
        Effect.mapError((error) => new InvalidRequest({ message: error.message })),
      )
      const problem = yield* Effect.promise(() => policyProblem(request))
      if (problem !== undefined) return yield* new PolicyDenied({ message: problem })
      const pending = runCapture(request, { allowPrivate, engine })
      running = pending
      const result = yield* Effect.promise(() => pending)
      return yield* HttpServerResponse.json(result).pipe(Effect.orDie)
    }).pipe(
      Effect.catchTag("InvalidRequest", ({ message }) =>
        rejected(400, { error: "InvalidRequest", message }),
      ),
      Effect.catchTag("PolicyDenied", ({ message }) =>
        rejected(400, { error: "PolicyDenied", message }),
      ),
      Effect.ensuring(release),
    )
  }),
)

const health = HttpRouter.add("GET", "/health", HttpServerResponse.text("ok"))

const port = Number(process.env.PORT ?? 8080)

const server = HttpRouter.serve(Layer.mergeAll(capture, health)).pipe(
  Layer.provide(NodeHttpServer.layer(createServer, { port, host: "0.0.0.0" })),
)

NodeRuntime.runMain(Layer.launch(server))
