import type { Vendor } from "./types.js"

/**
 * One request shape a tag sends its events in. Patterns are regular expression sources, kept to
 * syntax JavaScript and Python read alike, because the capture engine applies the same list in
 * both of its engines (`apps/browser/src/inject/collection.json`, written from this one by
 * `scripts/engine-endpoints.mjs` with `--write`; the build checks the copy).
 */
export interface CollectionEndpoint {
  vendor: Vendor
  /** A decoder reads it into hits; the others are collection requests no decoder reads. */
  decoded: boolean
  methods: readonly string[]
  /** Matched against the pathname. */
  path: string
  /** Query parameters that must have these values. */
  query: Readonly<Record<string, string>>
}

const HITS = ["GET", "POST"]

export const COLLECTION_ENDPOINTS: readonly CollectionEndpoint[] = [
  // GA4 on Google's hosts and on first-party collectors (server-side GTM, the Google tag gateway).
  {
    vendor: "ga4",
    decoded: true,
    methods: HITS,
    path: "/(g|r)/collect$",
    query: { v: "2" },
  },
  // The Google tag gateway's measurement hits. Google's docs do not name the path; two agency write-ups
  // report GA4 hits named `c?` under the measurement path (`/<measurement-path>/c?v=2&tid=G-…`).
  // Unconfirmed, so the decoder still needs `tid` and `en` before it calls the request a hit.
  {
    vendor: "ga4",
    decoded: true,
    methods: HITS,
    path: "/c$",
    query: { v: "2" },
  },
  // gtag sends conversions to googleadservices.com and remarketing to google.com/rmkt/collect.
  // While ad_storage is denied it sends the conversion to pagead2.googlesyndication.com instead.
  {
    vendor: "google-ads",
    decoded: true,
    methods: HITS,
    path: String.raw`^/pagead/conversion/(\d+)/?$`,
    query: {},
  },
  {
    vendor: "google-ads",
    decoded: true,
    methods: HITS,
    path: String.raw`^/pagead/1p-conversion/(\d+)/?$`,
    query: {},
  },
  {
    vendor: "google-ads",
    decoded: true,
    methods: HITS,
    path: String.raw`^/rmkt/collect/(\d+)/?$`,
    query: {},
  },
  {
    vendor: "google-ads",
    decoded: true,
    methods: HITS,
    path: String.raw`^/pagead/viewthroughconversion/(\d+)/?$`,
    query: {},
  },
  {
    vendor: "meta",
    decoded: true,
    methods: HITS,
    path: "^/tr/?$",
    query: {},
  },
  {
    vendor: "tiktok",
    decoded: true,
    methods: ["POST"],
    path: "^/api/v2/pixel/?$",
    query: {},
  },
  // Not decoded: google.com/ccm/collect and ad.doubleclick.net/ccm/s/collect mirror the same events
  // for Consent Mode (the latter has no account ID), google.com/pagead/1p-user-list is an
  // audience-sync echo of each rmkt hit, and TikTok's pixel/act carries page metadata, no event.
  {
    vendor: "google-ads",
    decoded: false,
    methods: HITS,
    path: "^/(ccm/collect|pagead/1p-user-list/)",
    query: {},
  },
  {
    vendor: "google-ads",
    decoded: false,
    methods: HITS,
    path: "^/pagead/set_partitioned_cookie$",
    query: {},
  },
  {
    vendor: "google-ads",
    decoded: false,
    methods: HITS,
    path: "^/ccm/s/collect$",
    query: {},
  },
  // Universal Analytics, which some old tags still send on any host, and Meta's attribution
  // registration, sent by the pixel next to its /tr hit.
  {
    vendor: "ga4",
    decoded: false,
    methods: HITS,
    path: "/j/collect$",
    query: { v: "1" },
  },
  {
    vendor: "meta",
    decoded: false,
    methods: HITS,
    path: "^/privacy_sandbox/pixel/register/trigger/?$",
    query: {},
  },
  {
    vendor: "tiktok",
    decoded: false,
    methods: ["POST"],
    path: "^/api/v2/pixel/act/?$",
    query: {},
  },
]

const compiled = COLLECTION_ENDPOINTS.map((endpoint) => ({
  endpoint,
  path: new RegExp(endpoint.path),
}))

/** The listed endpoint `url` is sent to, ignoring the method, with its path match. */
function endpointOf(url: URL) {
  for (const { endpoint, path } of compiled) {
    const match = path.exec(url.pathname)
    if (
      match !== null &&
      Object.entries(endpoint.query).every(([key, value]) => url.searchParams.get(key) === value)
    )
      return { endpoint, match }
  }
  return undefined
}

/**
 * The path match when `url` is an endpoint `vendor`'s decoder reads (its first group is the Google
 * Ads account ID); `undefined` otherwise.
 */
export function decodedBy(vendor: Vendor, url: URL): RegExpExecArray | undefined {
  const found = endpointOf(url)
  return found?.endpoint.decoded === true && found.endpoint.vendor === vendor
    ? found.match
    : undefined
}

/**
 * A request a tag sends its events in: one of the shapes above, on any host,
 * with one of its methods. Preflights and `HEAD` carry no event, so they are not.
 */
export function isCollectionRequest(method: string, url: string): boolean {
  if (!URL.canParse(url)) return false
  return endpointOf(new URL(url))?.endpoint.methods.includes(method.toUpperCase()) === true
}
