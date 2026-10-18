import { Context, Data, type Effect } from "effect"

export class BrowserError extends Data.TaggedError("BrowserError")<{
  readonly operation: string
  readonly cause: unknown
}> {}

export interface BrowserRun {
  readonly title: string
  /** Network requests the page made while loading. */
  readonly requests: number
}

/** A headless browser. The Cloudflare layer runs Playwright in the `apps/browser` container. */
export class Browser extends Context.Service<
  Browser,
  {
    /** Loads `url` and reports what the page did. */
    readonly run: (url: string) => Effect.Effect<BrowserRun, BrowserError>
  }
>()("@repo/core/Browser") {}
