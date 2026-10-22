import { decode } from "@ovriq/zinko-decoders"
import type { CaptureResult } from "@repo/capture-contract"
import type { DecodedHit } from "./types.js"

/**
 * Every hit the capture's requests carry, in request start order. The CLI and the audit workflow
 * both build `RunInput.hits` with it, so a run is judged the same way in both.
 */
export function decodeHits(capture: CaptureResult): DecodedHit[] {
  return capture.requests
    .flatMap((request) =>
      decode({ url: request.url, method: request.method, body: request.body }).map((hit) =>
        Object.assign(hit, {
          requestId: request.id,
          documentId: request.documentId,
          startedAt: request.startedAt,
        }),
      ),
    )
    .toSorted((a, b) => a.startedAt - b.startedAt)
}
