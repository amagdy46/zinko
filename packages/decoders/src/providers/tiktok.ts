import type { Decoder, Hit } from "../types.js"

type Json = Record<string, unknown>

function isJson(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function obj(value: unknown): Json {
  return isJson(value) ? value : {}
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined
}

// One event per POST. `/api/v2/pixel/act` (auto-collected page metadata, no event name) is not matched.
export const tiktok: Decoder = {
  vendor: "tiktok",
  methods: ["POST"],
  matches: (url) =>
    url.hostname === "analytics.tiktok.com" && /^\/api\/v2\/pixel\/?$/.test(url.pathname),

  decode(request, url) {
    let body: Json
    try {
      body = obj(JSON.parse(request.body ?? ""))
    } catch {
      return []
    }
    const context = obj(body.context)
    const destinationId = str(obj(context.pixel).code)
    const event = str(body.event)
    if (!destinationId || !event) return []

    const params: Hit["params"] = {}
    for (const [key, value] of Object.entries(obj(body.properties))) {
      if (typeof value === "string" || typeof value === "number") params[key] = value
    }
    const pageUrl = str(obj(context.page).url)
    if (pageUrl) params.page_location = pageUrl

    const ids: Hit["ids"] = {}
    const eventId = str(body.event_id)
    if (eventId) ids.eventId = eventId
    // `callback` is "<ttclid>.<unix ms>"; it is absent when the visit had no ttclid.
    const callback = str(obj(context.ad).callback)
    const ttclid = callback?.replace(/\.\d{10,}$/, "")
    if (ttclid) ids.ttclid = ttclid

    // TikTok has no per-hit consent flag; judge consent from whether the hit fired at all.
    return [
      {
        vendor: "tiktok",
        destinationId,
        event,
        batchIndex: 0,
        params,
        ids,
        consent: { adStorage: "unknown", analyticsStorage: "unknown" },
        host: url.host,
        url: url.href,
      },
    ]
  },
}
