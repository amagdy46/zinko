// The `POST /capture` contract, kept in step by hand with `packages/capture-contract`: the image
// builds from `apps/browser` alone, so it cannot import the workspace package. Consumers decode
// every response with the package's schemas, so a drift here shows up there as a decode error.
import { Schema } from "effect"

const Ms = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
const TargetUrl = Schema.String.check(Schema.isPattern(/^https?:\/\//i), Schema.isMaxLength(2048))

export const Scenario = Schema.Literals(["none", "accept", "reject", "gpc"])

const JourneyStep = Schema.Union([
  Schema.Struct({ action: Schema.Literal("goto"), url: TargetUrl }),
  Schema.Struct({ action: Schema.Literal("click"), selector: Schema.String }),
])

export const CaptureRequest = Schema.Struct({
  url: TargetUrl,
  scenario: Scenario,
  viewport: Schema.Literals(["desktop", "mobile"]),
  journey: Schema.optionalKey(Schema.Array(JourneyStep).check(Schema.isMaxLength(5))),
  blockVendorRequests: Schema.optionalKey(Schema.Boolean),
})
export type CaptureRequest = typeof CaptureRequest.Type

const CapturedDocument = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  redirects: Schema.Array(Schema.String),
  startedAt: Ms,
  title: Schema.NullOr(Schema.String),
})

const CapturedRequest = Schema.Struct({
  id: Schema.String,
  documentId: Schema.String,
  url: Schema.String,
  method: Schema.String,
  body: Schema.NullOr(Schema.String),
  bodyTruncated: Schema.Boolean,
  resourceType: Schema.String,
  status: Schema.NullOr(Schema.Finite),
  startedAt: Ms,
  blocked: Schema.Boolean,
})
export type CapturedRequest = typeof CapturedRequest.Type

const Cookie = Schema.Struct({
  name: Schema.String,
  value: Schema.String,
  domain: Schema.String,
  path: Schema.String,
  expires: Schema.NullOr(Schema.Finite),
  secure: Schema.Boolean,
  httpOnly: Schema.Boolean,
  sameSite: Schema.Literals(["Strict", "Lax", "None"]),
})

const CookieSnapshot = Schema.Struct({
  at: Ms,
  documentId: Schema.String,
  label: Schema.Literals(["before-consent", "after-consent", "document-end", "end"]),
  cookies: Schema.Array(Cookie),
})

const ConsentObservation = Schema.Struct({
  at: Ms,
  source: Schema.Literals(["tcf", "google", "cmp"]),
  state: Schema.Json,
})

const DataLayerPush = Schema.Struct({ at: Ms, documentId: Schema.String, value: Schema.Json })

const Consent = Schema.Struct({
  cmp: Schema.NullOr(Schema.String),
  outcome: Schema.Literals(["accepted", "rejected", "none", "not-found"]),
  actionAt: Schema.NullOr(Ms),
  completedAt: Schema.NullOr(Ms),
  observations: Schema.Array(ConsentObservation),
})
export type Consent = typeof Consent.Type

export const CaptureError = Schema.Struct({
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
export type CaptureError = typeof CaptureError.Type

export const EngineName = Schema.Literals(["scrapling", "playwright"])
export type EngineName = typeof EngineName.Type

export const CaptureResult = Schema.Struct({
  engine: Schema.Struct({
    name: EngineName,
    version: Schema.String,
    fallbackReason: Schema.NullOr(Schema.String),
  }),
  documents: Schema.Array(CapturedDocument),
  requests: Schema.Array(CapturedRequest),
  dataLayer: Schema.Array(DataLayerPush),
  cookies: Schema.Array(CookieSnapshot),
  consent: Consent,
  screenshot: Schema.NullOr(Schema.String),
  complete: Schema.Boolean,
  truncated: Schema.Boolean,
  errors: Schema.Array(CaptureError),
})
export type CaptureResult = typeof CaptureResult.Type

export type CaptureRejected = {
  readonly error: "PolicyDenied" | "InvalidRequest"
  readonly message: string
}

/** One NDJSON line an engine writes to stdout. The result is assembled from these. */
export const Checkpoint = Schema.Union([
  Schema.Struct({ type: Schema.Literal("engine"), name: EngineName, version: Schema.String }),
  Schema.Struct({ type: Schema.Literal("launch-failed"), message: Schema.String }),
  Schema.Struct({ type: Schema.Literal("document"), document: CapturedDocument }),
  Schema.Struct({ type: Schema.Literal("requests"), requests: Schema.Array(CapturedRequest) }),
  Schema.Struct({ type: Schema.Literal("dataLayer"), entries: Schema.Array(DataLayerPush) }),
  Schema.Struct({ type: Schema.Literal("cookies"), snapshot: CookieSnapshot }),
  Schema.Struct({ type: Schema.Literal("consent"), consent: Consent }),
  Schema.Struct({ type: Schema.Literal("screenshot"), data: Schema.String }),
  Schema.Struct({ type: Schema.Literal("error"), error: CaptureError }),
  Schema.Struct({ type: Schema.Literal("truncated") }),
  Schema.Struct({ type: Schema.Literal("done") }),
])
export type Checkpoint = typeof Checkpoint.Type

/** What Node hands an engine on stdin, as one JSON line. */
export const EngineJob = Schema.Struct({
  request: CaptureRequest,
  /** Wall-clock ms; every `at` in the result counts from here. */
  startedAt: Schema.Finite,
  /** Wall-clock ms at which Node asks the engine to finalize. */
  finalizeAt: Schema.Finite,
  proxy: Schema.String,
  profileDir: Schema.String,
  files: Schema.Struct({
    shim: Schema.String,
    vendors: Schema.String,
    chromium: Schema.String,
    autoconsent: Schema.String,
    rules: Schema.String,
  }),
  limits: Schema.Struct({
    requests: Schema.Finite,
    bodyBytes: Schema.Finite,
    dataLayer: Schema.Finite,
  }),
})
export type EngineJob = typeof EngineJob.Type

/** `src/inject/vendors.json`: the hosts `blockVendorRequests` answers, except the SDK files. */
export const Vendors = Schema.Struct({
  hosts: Schema.Array(Schema.String),
  sdkFiles: Schema.String,
})

/** `src/chromium-args.json`: the switches both engines launch Chromium with. */
export const ChromiumArgs = Schema.Struct({
  args: Schema.Array(Schema.String),
  disableFeatures: Schema.Array(Schema.String),
  /** Chromium's own update and sign-in endpoints; the egress proxy always refuses them. */
  serviceHosts: Schema.Array(Schema.String),
})
