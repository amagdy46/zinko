import type { Decoder, Hit, RequestLike } from "../types.js"

const ID_KEYS: Record<string, string> = {
  eid: "eventId",
  fbp: "fbp",
  fbc: "fbc",
  external_id: "externalId",
}

/** A Meta request's fields: the query, with the form-encoded body (POST hits) overriding it. */
export function metaRequestParams(request: RequestLike, url: URL): URLSearchParams {
  const params = new URLSearchParams(url.search)
  if (request.body && !request.body.trimStart().startsWith("--")) {
    for (const [k, v] of new URLSearchParams(request.body)) params.set(k, v)
  }
  return params
}

export const meta: Decoder = {
  vendor: "meta",
  methods: ["GET", "POST"],
  matches: (url) => /(^|\.)facebook\.com$/.test(url.hostname) && /^\/tr\/?$/.test(url.pathname),

  decode(request, url) {
    const params = metaRequestParams(request, url)
    const destinationId = params.get("id")
    const event = params.get("ev")
    if (!destinationId || !event) return []

    const eventParams: Hit["params"] = {}
    const ids: Hit["ids"] = {}
    for (const [key, value] of params) {
      const custom = /^cd\[(.+)\]$/.exec(key)
      if (custom) {
        const n = Number(value)
        eventParams[custom[1]!] =
          value !== "" && Number.isFinite(n) && custom[1] !== "content_ids" ? n : value
      } else if (key in ID_KEYS) ids[ID_KEYS[key]!] = value
    }
    const dl = params.get("dl")
    if (dl) eventParams.page_location = dl

    // Meta has no per-hit consent flag; consent must be judged from whether the hit fired at all.
    return [
      {
        vendor: "meta",
        destinationId,
        event,
        batchIndex: 0,
        params: eventParams,
        ids,
        consent: { adStorage: "unknown", analyticsStorage: "unknown" },
        host: url.host,
        url: url.href,
      },
    ]
  },
}
