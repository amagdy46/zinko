import type { ConsentState, Decoder, Hit } from "../types.js"

const ID_KEYS: Record<string, string> = {
  cid: "clientId",
  sid: "sessionId",
  uid: "userId",
  _p: "pageLoadId",
}

/** `gcs` is "G1" + ad_storage + analytics_storage, each "1" (granted) or "0" (denied). */
const CONSENT_FLAGS: Record<string, ConsentState> = { "1": "granted", "0": "denied" }

function flag(c: string | undefined): ConsentState {
  return (c !== undefined && CONSENT_FLAGS[c]) || "unknown"
}

function parseGcs(gcs: string | undefined): Hit["consent"] {
  if (!gcs || !/^G1[01]{2}$/.test(gcs))
    return { adStorage: "unknown", analyticsStorage: "unknown", raw: gcs }
  return { adStorage: flag(gcs[2]), analyticsStorage: flag(gcs[3]), raw: gcs }
}

function toHit(params: URLSearchParams, url: URL): Hit | null {
  const destinationId = params.get("tid")
  const event = params.get("en")
  if (!destinationId || !event) return null

  const eventParams: Hit["params"] = {}
  const ids: Hit["ids"] = {}
  for (const [key, value] of params) {
    if (key.startsWith("ep.")) eventParams[key.slice(3)] = value
    else if (key.startsWith("epn.")) eventParams[key.slice(4)] = Number(value)
    else if (key in ID_KEYS) ids[ID_KEYS[key]!] = value
  }
  // Common built-ins worth surfacing as params.
  for (const [key, name] of [
    ["dl", "page_location"],
    ["dr", "page_referrer"],
    ["dt", "page_title"],
    ["cu", "currency"],
  ] as const) {
    const v = params.get(key)
    if (v !== null && !(name in eventParams)) eventParams[name] = v
  }

  return {
    vendor: "ga4",
    destinationId,
    event,
    params: eventParams,
    ids,
    consent: parseGcs(params.get("gcs") ?? undefined),
    host: url.host,
    url: url.href,
  }
}

export const ga4: Decoder = {
  vendor: "ga4",
  // Matches Google's endpoints and first-party (server-side GTM) collectors alike.
  matches: (url) => url.pathname.endsWith("/g/collect") && url.searchParams.get("v") === "2",

  decode(request, url) {
    const lines = (request.body ?? "").split(/\r?\n/).filter((l) => l.trim() !== "")
    // Batched POSTs: shared params in the URL, one event per body line.
    const batches = lines.length > 0 ? lines : [""]
    return batches.flatMap((line) => {
      const merged = new URLSearchParams(url.search)
      for (const [k, v] of new URLSearchParams(line)) merged.set(k, v)
      const hit = toHit(merged, url)
      return hit ? [hit] : []
    })
  },
}
