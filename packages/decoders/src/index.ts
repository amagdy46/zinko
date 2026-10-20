import { ga4 } from "./providers/ga4.js"
import { googleAds } from "./providers/google-ads.js"
import { meta } from "./providers/meta.js"
import { tiktok } from "./providers/tiktok.js"
import type { Decoder, Hit, RequestLike } from "./types.js"

export type { ConsentState, Decoder, Hit, RequestLike, Vendor } from "./types.js"
export { ga4, googleAds, meta, tiktok }

export const decoders: readonly Decoder[] = [ga4, googleAds, meta, tiktok]

/**
 * Stored with every decoded hit, so hits decoded by an older version can be found and decoded
 * again from their stored capture. Raise it whenever a decoder's output changes.
 */
export const DECODER_VERSION = "1"

/** Decode a request into zero or more hits. Returns [] for requests no decoder recognizes. */
export function decode(request: RequestLike, using: readonly Decoder[] = decoders): Hit[] {
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return []
  }
  const method = (request.method ?? "GET").toUpperCase()
  const decoder = using.find((d) => d.matches(url) && d.methods.includes(method))
  return decoder ? decoder.decode(request, url) : []
}
