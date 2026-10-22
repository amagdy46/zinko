import type { DecodedHit, RunInput } from "./types.js"

/**
 * Meta's `ts`, the millisecond the pixel built the event: a second send with the same `ts` is the
 * pixel retrying one event, not a second event.
 */
function metaEventTime(request: RunInput["capture"]["requests"][number]): string | null {
  const query = request.body ?? new URL(request.url).search
  return new URLSearchParams(query).get("ts")
}

/**
 * The hits without the pixel's own retries. When a request is answered locally
 * (`blockVendorRequests`) the pixel cannot confirm delivery and sends the same event again by
 * another route (a form post, then a fetch), so one `PageView` shows up twice with the same event
 * ID and `ts`. Meta counts that once too, so duplicate rules must not read it as a second event.
 */
export function withoutRetransmissions(
  input: RunInput,
  hits: readonly DecodedHit[],
): readonly DecodedHit[] {
  const requests = new Map(input.capture.requests.map((request) => [request.id, request]))
  const seen = new Set<string>()
  return hits.filter((hit) => {
    const request = hit.vendor === "meta" ? requests.get(hit.requestId) : undefined
    const time = request === undefined ? null : metaEventTime(request)
    if (time === null) return true
    const key = [hit.documentId, hit.destinationId, hit.event, hit.ids.eventId ?? "", time].join(
      " ",
    )
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
