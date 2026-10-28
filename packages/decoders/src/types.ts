/** A captured outgoing request, as seen by Playwright or read from a HAR entry. */
export interface RequestLike {
  url: string
  method?: string
  /** Raw request body, if any. */
  body?: string | null
}

export type Vendor = "ga4" | "meta" | "google-ads" | "tiktok"

/** Who runs the endpoint a hit was sent to: Google's own hosts, or a first-party one (a server-side GTM container on a custom domain, or the Google tag gateway on the site's own path). */
export type Collector = "google" | "first-party"

export type ConsentState = "granted" | "denied" | "unknown"

export type GcdState = "unset" | "granted" | "denied"

/** One consent type in a `gcd` value: the state set by `default` and by a later `update`; `unset` when never set. */
export interface GcdSignal {
  default: GcdState
  update: GcdState
}

/** Google's `gcd` parameter, read per signal. It covers `ad_user_data` and `ad_personalization`, which `gcs` does not. */
export interface Gcd {
  raw: string
  adStorage: GcdSignal
  analyticsStorage: GcdSignal
  adUserData: GcdSignal
  adPersonalization: GcdSignal
}

/** One tracking event decoded from a request. A single request can carry several (GA4 batching). */
export interface Hit {
  vendor: Vendor
  /** Destination ID: GA4 measurement ID (G-XXXX), Meta pixel ID, Google Ads AW-<id> or TikTok pixel code. */
  destinationId: string
  event: string
  /** Position of this hit within its request (0 unless the request batches several events). */
  batchIndex: number
  /** Event parameters with vendor prefixes stripped; numeric params are numbers. */
  params: Record<string, string | number>
  /** Vendor-level identifiers (client ID, session ID, event ID, fbp/fbc...). */
  ids: Record<string, string>
  consent: { adStorage: ConsentState; analyticsStorage: ConsentState; raw?: string }
  /** The request's parsed `gcd` (GA4 and Google Ads); absent when the request has none or it is not readable. */
  gcd?: Gcd
  /**
   * Set on GA4 and Google Ads hits. `first-party` when the request has a Google tag's payload shape but went to a host that is not
   * Google's, so the hit reached a collector the site runs or proxies. Decided by host, after the path
   * and query have said the request is a hit.
   */
  collector?: Collector
  /** Host the hit was sent to. */
  host: string
  url: string
}

export interface Decoder {
  vendor: Vendor
  /** HTTP methods this vendor uses for hits; other methods (OPTIONS preflights, HEAD) are not hits. */
  methods: readonly string[]
  matches(url: URL): boolean
  decode(request: RequestLike, url: URL): Hit[]
}
