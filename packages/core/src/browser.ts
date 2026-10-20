import type { CaptureRejected, CaptureRequest, CaptureResult } from "@repo/capture-contract"
import { Context, Data, type Effect } from "effect"

export class BrowserError extends Data.TaggedError("BrowserError")<{
  readonly operation: string
  readonly cause: unknown
  /** Set when the engine refused the request (HTTP 400); nothing was captured. */
  readonly rejected?: CaptureRejected
}> {}

/** A headless browser. The Cloudflare layer runs the capture engine in the `apps/browser` container. */
export class Browser extends Context.Service<
  Browser,
  {
    /** Loads `request.url` under one consent scenario and reports what the page did. */
    readonly capture: (request: CaptureRequest) => Effect.Effect<CaptureResult, BrowserError>
  }
>()("@repo/core/Browser") {}
