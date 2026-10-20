// The `POST /capture` contract between consumers (web, CLI) and the engine in `apps/browser`.
// The engine cannot import this package (its image builds from `apps/browser` alone), so it
// writes this shape by hand and consumers validate every response with these schemas.
import { Schema } from "effect"

/** Milliseconds since the capture started. Every `at` and `*At` field uses this one clock. */
const Ms = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))

/** A URL we ask the engine to open; captured URLs are not bounded, since pages emit longer ones. */
const TargetUrl = Schema.String.check(Schema.isPattern(/^https?:\/\//i), Schema.isMaxLength(2048))

/** `gpc` sends `Sec-GPC: 1` and sets `navigator.globalPrivacyControl`, with no banner action. */
export const Scenario = Schema.Literals(["none", "accept", "reject", "gpc"])
export type Scenario = typeof Scenario.Type

/** Runs in the same browser context, after the start URL has loaded and the consent action. */
export const JourneyStep = Schema.Union([
  Schema.Struct({ action: Schema.Literal("goto"), url: TargetUrl }),
  Schema.Struct({ action: Schema.Literal("click"), selector: Schema.String }),
])
export type JourneyStep = typeof JourneyStep.Type

/**
 * A hostname exactly as `URL` gives it (lowercase, punycode ASCII, IP literals normalized), without
 * a trailing dot. Mirrored in `apps/browser/src/contract.ts`.
 */
const CanonicalHost = Schema.String.check(
  Schema.isMaxLength(253),
  Schema.makeFilter(
    (host: string) =>
      !host.endsWith(".") &&
      URL.canParse(`http://${host}`) &&
      new URL(`http://${host}`).hostname === host,
    { expected: "a canonical hostname, as URL gives it, with no trailing dot" },
  ),
)

export const CaptureRequest = Schema.Struct({
  url: TargetUrl,
  scenario: Scenario,
  viewport: Schema.Literals(["desktop", "mobile"]),
  journey: Schema.optionalKey(Schema.Array(JourneyStep).check(Schema.isMaxLength(5))),
  blockVendorRequests: Schema.optionalKey(Schema.Boolean),
  /**
   * The site's hosts. A top-level navigation (the start URL, each redirect hop, each journey step)
   * whose host is not one of these or a subdomain of one is stopped before it is sent, and the
   * capture ends with a `Navigation` error naming the host; so does a main-frame navigation to a
   * non-http(s) URL such as `about:blank`. Popups are blocked. Subresources are not affected.
   */
  allowedHosts: Schema.optionalKey(Schema.Array(CanonicalHost).check(Schema.isMaxLength(20))),
})
export type CaptureRequest = typeof CaptureRequest.Type

/** One top-level navigation: the start URL, then one per journey step that navigates. */
export const CapturedDocument = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  /** Redirect hops before `url`, in order. */
  redirects: Schema.Array(Schema.String),
  startedAt: Ms,
  title: Schema.NullOr(Schema.String),
})
export type CapturedDocument = typeof CapturedDocument.Type

export const CapturedRequest = Schema.Struct({
  id: Schema.String,
  documentId: Schema.String,
  url: Schema.String,
  method: Schema.String,
  body: Schema.NullOr(Schema.String),
  /** The body was cut at the engine's per-request limit. */
  bodyTruncated: Schema.Boolean,
  /** Playwright's resource type: `document`, `script`, `fetch`, `image`, `ping`, ... */
  resourceType: Schema.String,
  /** `null` when no response arrived (aborted, failed or still in flight). */
  status: Schema.NullOr(Schema.Finite),
  startedAt: Ms,
  /** Answered locally by `blockVendorRequests` or refused by the URL policy. */
  blocked: Schema.Boolean,
})
export type CapturedRequest = typeof CapturedRequest.Type

export const Cookie = Schema.Struct({
  name: Schema.String,
  value: Schema.String,
  domain: Schema.String,
  path: Schema.String,
  /** Unix time in seconds (wall clock, not the capture clock); `null` for a session cookie. */
  expires: Schema.NullOr(Schema.Finite),
  secure: Schema.Boolean,
  httpOnly: Schema.Boolean,
  sameSite: Schema.Literals(["Strict", "Lax", "None"]),
})
export type Cookie = typeof Cookie.Type

/**
 * `after-consent` is taken the moment autoconsent reports completion. `document-end` is taken
 * before each journey navigation leaves a document; `end` once, after the journey.
 */
export const CookieSnapshot = Schema.Struct({
  at: Ms,
  documentId: Schema.String,
  label: Schema.Literals(["before-consent", "after-consent", "document-end", "end"]),
  cookies: Schema.Array(Cookie),
})
export type CookieSnapshot = typeof CookieSnapshot.Type

/** `tcf` is read from `__tcfapi`, `google` from the consent commands pushed to `dataLayer`. */
export const ConsentObservation = Schema.Struct({
  at: Ms,
  source: Schema.Literals(["tcf", "google", "cmp"]),
  state: Schema.Json,
})
export type ConsentObservation = typeof ConsentObservation.Type

/** gtag's `Arguments` pushes arrive as arrays. */
const DataLayerPush = Schema.Struct({ at: Ms, documentId: Schema.String, value: Schema.Json })

const CaptureError = Schema.Struct({
  code: Schema.Literals([
    "BotBlocked",
    "Timeout",
    "CmpNotFound",
    "Navigation",
    "JourneyStep",
    "EngineFailure",
  ]),
  message: Schema.String,
  at: Ms,
})

/**
 * What one scenario captured. Failures after the request was accepted still produce a result:
 * `complete: false`, the missing artifacts empty or `null`, and an `errors` entry for each.
 */
export const CaptureResult = Schema.Struct({
  engine: Schema.Struct({
    name: Schema.Literals(["scrapling", "playwright"]),
    version: Schema.String,
    /** Why the server picked `playwright` over `scrapling`; `null` on the primary engine. */
    fallbackReason: Schema.NullOr(Schema.String),
  }),
  documents: Schema.Array(CapturedDocument),
  requests: Schema.Array(CapturedRequest),
  dataLayer: Schema.Array(DataLayerPush),
  cookies: Schema.Array(CookieSnapshot),
  consent: Schema.Struct({
    cmp: Schema.NullOr(Schema.String),
    outcome: Schema.Literals(["accepted", "rejected", "none", "not-found"]),
    actionAt: Schema.NullOr(Ms),
    completedAt: Schema.NullOr(Ms),
    observations: Schema.Array(ConsentObservation),
  }),
  /** Base64 PNG of the last page. */
  screenshot: Schema.NullOr(Schema.String),
  complete: Schema.Boolean,
  /** A capture limit (duration, requests, body size, `dataLayer` entries, bytes) was hit. */
  truncated: Schema.Boolean,
  errors: Schema.Array(CaptureError),
})
export type CaptureResult = typeof CaptureResult.Type

/** The HTTP 400 body: the engine refused the request and captured nothing. */
export const CaptureRejected = Schema.Struct({
  error: Schema.Literals(["PolicyDenied", "InvalidRequest"]),
  message: Schema.String,
})
export type CaptureRejected = typeof CaptureRejected.Type

// Mirrors `apps/browser/src/inject/vendors.json`, which the engine reads (its image cannot
// import this package). Keep the two in step.
const VENDOR_DOMAINS = [
  "google-analytics.com",
  "googletagmanager.com",
  "googleadservices.com",
  "google.com",
  "doubleclick.net",
  "googlesyndication.com",
  "facebook.com",
  "connect.facebook.net",
  "instagram.com",
  "conversionsapigateway.com",
  "tiktok.com",
  "tiktokw.us",
]
const SDK_FILES = new RegExp(
  String.raw`^https://(www\.googletagmanager\.com/(gtag/js|gtm\.js)(?=[?#]|$)|connect\.facebook\.net/([\w-]+/fbevents\.js(?=[?#]|$)|signals/config/)|analytics\.tiktok\.com/i18n/pixel/)`,
)

/** The URL's host is a vendor domain or any subdomain of one. */
export function isVendorHost(url: string): boolean {
  if (!URL.canParse(url)) return false
  const host = new URL(url).hostname.toLowerCase().replace(/\.$/, "")
  return VENDOR_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))
}

/** A vendor SDK file (gtag, GTM, the Meta and TikTok pixel scripts): loaded, not a hit. */
export function isSdkFile(url: string): boolean {
  return SDK_FILES.test(url)
}
