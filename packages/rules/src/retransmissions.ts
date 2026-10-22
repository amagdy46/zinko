import { metaRequestParams } from "@ovriq/zinko-decoders"
import type { DecodedHit, RunInput } from "./types.js"

/*
 * Fields that differ between two sends of one event and say nothing about the event. Observed on
 * a real pair (Allbirds, one `PageView` sent twice): `rqm` names the transport (`formPOST`, then
 * `fetch`) and `ie[i]` appears only on the second send. Every other field was identical, so
 * anything else that differs makes two hits two events.
 */
const TRANSPORT_FIELDS = new Set(["rqm", "ie[i]"])

/** One Meta request's whole payload, minus the transport fields, as a comparable string. */
function payload(input: RunInput, hit: DecodedHit): string | null {
  const request = input.capture.requests.find((candidate) => candidate.id === hit.requestId)
  if (request === undefined) return null
  const params = metaRequestParams(request, new URL(request.url))
  return JSON.stringify(
    [...params]
      .filter(([key]) => !TRANSPORT_FIELDS.has(key))
      .toSorted(([a], [b]) => (a < b ? -1 : 1)),
  )
}

/**
 * The hits without the pixel's own retries. When a request is answered locally
 * (`blockVendorRequests`) the pixel cannot confirm delivery and sends the same event again by
 * another route, so one event shows up twice. Two Meta hits are one event only when they are on the
 * same document, for the same pixel, with the same fields apart from the transport ones (so the
 * same `ts`, event ID and custom data); two different events that share a millisecond differ in
 * their custom data and stay two. Meta counts a retry once too, so duplicate rules must not read it
 * as a second event.
 */
export function withoutRetransmissions(
  input: RunInput,
  hits: readonly DecodedHit[],
): readonly DecodedHit[] {
  const seen = new Set<string>()
  return hits.filter((hit) => {
    if (hit.vendor !== "meta") return true
    const fields = payload(input, hit)
    if (fields === null) return true
    const key = `${hit.documentId} ${hit.destinationId} ${fields}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
