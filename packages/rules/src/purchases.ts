import { count, hitRef } from "./documents.js"
import { inconclusive } from "./results.js"
import type { CheckResult, DecodedHit, RunInput } from "./types.js"

/** Google's own order id on a granted conversion (`GG_…`): the page did not set it. */
function isGoogleGenerated(id: string): boolean {
  return id.startsWith("GG_")
}

/** The order id the page set on a conversion; empty and Google-generated ids are not one. */
export function pageOrderId(hit: DecodedHit): string | undefined {
  const id = transactionId(hit)
  return id === undefined || isGoogleGenerated(id) ? undefined : id
}

/** A `dataLayer` push that announces a purchase: `gtag("event", "purchase", …)` or `{ event: "purchase" }`. */
function isPurchasePush(value: unknown): boolean {
  if (Array.isArray(value)) return value[0] === "event" && value[1] === "purchase"
  return (
    typeof value === "object" && value !== null && "event" in value && value.event === "purchase"
  )
}

/** The documents that announce a purchase themselves: a GA4 `purchase` hit or a `purchase` push. */
function announcingDocuments(input: RunInput): ReadonlySet<string> {
  return new Set([
    ...input.hits
      .filter((hit) => hit.vendor === "ga4" && hit.event === "purchase")
      .map((hit) => hit.documentId),
    ...input.capture.dataLayer
      .filter((push) => isPurchasePush(push.value))
      .map((push) => push.documentId),
  ])
}

const isAdsConversionWithValue = (hit: DecodedHit): boolean =>
  hit.vendor === "google-ads" && hit.event === "conversion" && hit.params.value !== undefined

/**
 * The run's purchase hits. GA4 `purchase`; Meta `Purchase`; TikTok `Purchase` (its `CompletePayment`
 * goes out as `Purchase`). Google Ads cannot say which conversion labels are purchases, so the page
 * has to: an Ads conversion with a `value` counts when it carries an order id the page set, or its
 * document sends a GA4 `purchase` or pushes a `purchase` event. Remarketing hits carry `value` too
 * but have no label and are never purchases.
 */
export function purchasesOf(input: RunInput): DecodedHit[] {
  const announcing = announcingDocuments(input)
  return input.hits.filter((hit) => {
    if (isAdsConversionWithValue(hit))
      return pageOrderId(hit) !== undefined || announcing.has(hit.documentId)
    return (
      (hit.vendor === "ga4" && hit.event === "purchase") ||
      (hit.vendor === "meta" && hit.event === "Purchase") ||
      (hit.vendor === "tiktok" && (hit.event === "Purchase" || hit.event === "CompletePayment"))
    )
  })
}

/** Ads conversions with a value that the page gave no sign of being purchases: not counted, not ruled out. */
export function undecidedConversions(input: RunInput): DecodedHit[] {
  const purchases = new Set(purchasesOf(input))
  return input.hits.filter((hit) => isAdsConversionWithValue(hit) && !purchases.has(hit))
}

/** The verdict of a purchase rule when the run's only candidates are conversions it cannot classify. */
export function undecidedResult(ruleId: string, hits: readonly DecodedHit[]): CheckResult {
  return inconclusive(
    ruleId,
    `${count(hits.length, "Google Ads conversion")} with a value, but no order id from the page and no GA4 or dataLayer purchase on the same document, so it cannot be told whether they are purchases`,
    hits.map(hitRef),
  )
}

const REQUIRED: Record<DecodedHit["vendor"], readonly string[]> = {
  ga4: ["transaction_id", "value", "currency"],
  "google-ads": ["transaction_id", "currency"],
  meta: ["value", "currency"],
  tiktok: ["value", "currency"],
}

/** A finite number, or a string that is one (`"49.9"`); `0` counts. */
function isNumeric(value: string | number): boolean {
  return typeof value === "number"
    ? Number.isFinite(value)
    : value.trim() !== "" && Number.isFinite(Number(value))
}

/** The required fields a purchase hit lacks; a `value` that is not a number counts as missing. */
export function missingFields(hit: DecodedHit): string[] {
  return REQUIRED[hit.vendor].filter((field) => {
    if (field === "transaction_id" && hit.vendor === "google-ads")
      return pageOrderId(hit) === undefined
    const value = hit.params[field]
    if (value === undefined) return true
    return field === "value" ? !isNumeric(value) : value === ""
  })
}

export function transactionId(hit: DecodedHit): string | undefined {
  const value = hit.params.transaction_id
  return value === undefined || value === "" ? undefined : String(value)
}
