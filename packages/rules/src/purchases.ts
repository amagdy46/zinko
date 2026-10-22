import type { DecodedHit } from "./types.js"

/**
 * A hit that reports a purchase. GA4 `purchase`; Meta `Purchase`; TikTok `Purchase` (its
 * `CompletePayment` goes out as `Purchase`). Google Ads cannot say which conversion labels are
 * purchases, so an Ads conversion (a hit with a conversion label) that carries `value` counts as one;
 * remarketing hits carry `value` too but have no label and are never purchases.
 */
const PURCHASE: Record<DecodedHit["vendor"], (hit: DecodedHit) => boolean> = {
  ga4: (hit) => hit.event === "purchase",
  meta: (hit) => hit.event === "Purchase",
  tiktok: (hit) => hit.event === "Purchase" || hit.event === "CompletePayment",
  "google-ads": (hit) => hit.event === "conversion" && hit.params.value !== undefined,
}

export function isPurchase(hit: DecodedHit): boolean {
  return PURCHASE[hit.vendor](hit)
}

const REQUIRED: Record<DecodedHit["vendor"], readonly string[]> = {
  ga4: ["transaction_id", "value", "currency"],
  "google-ads": ["transaction_id", "currency"],
  meta: ["value", "currency"],
  tiktok: ["value", "currency"],
}

/** The required fields a purchase hit lacks; a non-numeric `value` counts as missing. */
export function missingFields(hit: DecodedHit): string[] {
  return REQUIRED[hit.vendor].filter((field) => {
    const value = hit.params[field]
    return value === undefined || value === "" || (typeof value === "number" && Number.isNaN(value))
  })
}

export function transactionId(hit: DecodedHit): string | undefined {
  const value = hit.params.transaction_id
  return value === undefined || value === "" ? undefined : String(value)
}
