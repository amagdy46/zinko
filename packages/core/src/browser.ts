import type { CaptureRejected, CaptureRequest, CaptureResult } from "@repo/capture-contract"
import { Context, Data, type Effect } from "effect"

export class BrowserError extends Data.TaggedError("BrowserError")<{
  readonly operation: string
  readonly cause: unknown
  /** Set when the engine refused the request (HTTP 400); nothing was captured. */
  readonly rejected?: CaptureRejected
  /** The engine's HTTP status. 503: no container was available (over `maxInstances` or failed to start), retry later. */
  readonly status?: number
}> {}

/** A headless browser. The Cloudflare layer runs the capture engine in the `apps/browser` container. */
export class Browser extends Context.Service<
  Browser,
  {
    /**
     * Loads `request.url` under one consent scenario and reports what the page did. `instance`
     * names the container (default `"default"`); each name runs separately.
     */
    readonly capture: (
      request: CaptureRequest,
      options?: { readonly instance?: string },
    ) => Effect.Effect<CaptureResult, BrowserError>
  }
>()("@repo/core/Browser") {}
