import type { ConsentState, Decoder, Hit } from "../types.js"

// gtag sends conversions to googleadservices.com and remarketing to google.com/rmkt/collect.
// Left out on purpose: google.com/ccm/collect and ad.doubleclick.net/ccm/s/collect mirror the same
// events for Consent Mode (the latter has no account ID), and google.com/pagead/1p-user-list is an
// audience-sync echo of each rmkt hit; decoding them would count every event twice.
const ENDPOINTS = [
  { host: /(^|\.)googleadservices\.com$/, path: /^\/pagead\/conversion\/(\d+)\/?$/ },
  { host: /^(www\.)?google\.com$/, path: /^\/pagead\/1p-conversion\/(\d+)\/?$/ },
  { host: /^(www\.)?google\.com$/, path: /^\/rmkt\/collect\/(\d+)\/?$/ },
  {
    host: /^googleads\.g\.doubleclick\.net$/,
    path: /^\/pagead\/viewthroughconversion\/(\d+)\/?$/,
  },
]

function accountId(url: URL): string | null {
  for (const { host, path } of ENDPOINTS) {
    const id = host.test(url.hostname) ? path.exec(url.pathname)?.[1] : undefined
    if (id) return id
  }
  return null
}

/** `gcs` is "G1" + ad_storage + analytics_storage, each "1" (granted) or "0" (denied). */
function flag(c: string | undefined): ConsentState {
  if (c === "1") return "granted"
  return c === "0" ? "denied" : "unknown"
}

function parseGcs(gcs: string | null): Hit["consent"] {
  if (!gcs || !/^G1[01]{2}$/.test(gcs))
    return { adStorage: "unknown", analyticsStorage: "unknown", raw: gcs ?? undefined }
  return { adStorage: flag(gcs[2]), analyticsStorage: flag(gcs[3]), raw: gcs }
}

export const googleAds: Decoder = {
  vendor: "google-ads",
  methods: ["GET", "POST"],
  matches: (url) => accountId(url) !== null,

  decode(_request, url) {
    const id = accountId(url)
    if (!id) return []
    const q = url.searchParams

    const params: Hit["params"] = {}
    const label = q.get("label")
    if (label) params.label = label
    // The GA-style event that triggered the hit (purchase, view_item, gtag.config...).
    const eventName = q.get("en")
    if (eventName) params.event_name = eventName
    const value = q.get("value")
    if (value && Number.isFinite(Number(value))) params.value = Number(value)
    for (const [key, name] of [
      ["currency_code", "currency"],
      ["oid", "transaction_id"],
      ["url", "page_location"],
    ] as const) {
      const v = q.get(key)
      if (v) params[name] = v
    }

    // Conversion and remarketing hits carry the click ID as `gclaw` (read from the _gcl_aw cookie).
    const ids: Hit["ids"] = {}
    const gclid = q.get("gclaw")
    if (gclid) ids.gclid = gclid

    return [
      {
        vendor: "google-ads",
        destinationId: `AW-${id}`,
        event: label ? "conversion" : "remarketing",
        batchIndex: 0,
        params,
        ids,
        consent: parseGcs(q.get("gcs")),
        host: url.host,
        url: url.href,
      },
    ]
  },
}
