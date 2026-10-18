import { ga4 } from "./providers/ga4.js"
import { meta } from "./providers/meta.js"
import type { Decoder, Hit, RequestLike } from "./types.js"

export type { ConsentState, Decoder, Hit, RequestLike, Vendor } from "./types.js"
export { ga4, meta }

export const decoders: readonly Decoder[] = [ga4, meta]

/** Decode a request into zero or more hits. Returns [] for requests no decoder recognizes. */
export function decode(request: RequestLike, using: readonly Decoder[] = decoders): Hit[] {
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return []
  }
  const decoder = using.find((d) => d.matches(url))
  return decoder ? decoder.decode(request, url) : []
}
