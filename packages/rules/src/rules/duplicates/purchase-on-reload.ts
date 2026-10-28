import { count, documentRef, groupBy, hitRef, vendorName } from "../../documents.js"
import { isPurchase, transactionId } from "../../purchases.js"
import { fail, inconclusive, nonEmpty, notApplicable, pass } from "../../results.js"
import type { DecodedHit, EvidenceRef, Rule } from "../../types.js"

const id = "duplicates.purchase-on-reload"

/** Meta and TikTok purchases carry no order id, so only Google's can be matched. */
function isGooglePurchase(hit: DecodedHit): boolean {
  return (hit.vendor === "ga4" || hit.vendor === "google-ads") && isPurchase(hit)
}

/** The same order for the same destination (and, for Ads, the same conversion label). */
function orderKey(hit: DecodedHit, order: string): string {
  const label = hit.vendor === "google-ads" ? String(hit.params.label ?? "") : ""
  return [hit.vendor, hit.destinationId, label, order].join(" ")
}

export const purchaseOnReload: Rule = {
  id,
  area: "duplicates",
  severity: "warning",
  owner: "developer",
  title: "Purchase sent again when the confirmation page is reloaded",
  checkTitle: "Purchase not repeated on reload",
  why: "A visitor who reloads the order confirmation page (or comes back to it from their history) makes the page send the same purchase again. GA4 and Google Ads drop a repeat only when it carries the same transaction ID and arrives within their deduplication rules, so revenue and conversions are inflated. Only Google's purchases are compared: Meta and TikTok purchases carry no order id, so this check says nothing about them, and it is not a verdict on server-side deduplication.",
  fix: [
    "Fire the purchase once per order: remember on the page (storage) or on the server that this order was already tracked, and skip the tag on a reload.",
    "Always send the order's transaction_id, so GA4 and Google Ads can drop the repeats that still get through.",
  ],
  evaluate(input) {
    if (!input.journey) return notApplicable(id, "only checked on journey runs")
    const { documents } = input.capture
    if (documents[0]?.navigation === undefined)
      return inconclusive(
        id,
        "this capture predates reload and follow metadata, so how each page was reached is unknown",
      )
    const reloaded = documents.at(-1)
    const before = documents.at(-2)
    if (reloaded?.navigation !== "reload" || before === undefined)
      return notApplicable(id, "the run did not end on a reload")

    const byDocument = groupBy(input.hits.filter(isGooglePurchase), (hit) => hit.documentId)
    const earlier = byDocument.get(before.id) ?? []
    const later = byDocument.get(reloaded.id) ?? []
    if (earlier.length === 0)
      return notApplicable(id, "no Google purchase was sent before the reload")

    const previous = new Map<string, DecodedHit>()
    for (const hit of earlier) {
      const order = transactionId(hit)
      if (order !== undefined) previous.set(orderKey(hit, order), hit)
    }
    const repeats: { first: DecodedHit; again: DecodedHit }[] = []
    for (const hit of later) {
      const order = transactionId(hit)
      const first = order === undefined ? undefined : previous.get(orderKey(hit, order))
      if (first !== undefined) repeats.push({ first, again: hit })
    }
    const cited = nonEmpty(
      repeats.flatMap<EvidenceRef>(({ first, again }) => [hitRef(first), hitRef(again)]),
    )
    if (cited !== null) {
      const what = [...new Set(repeats.map(({ again }) => vendorName(again.vendor)))].join(" and ")
      return fail(
        id,
        `${what} sent the same purchase again after the page was reloaded (${count(repeats.length, "repeated purchase")}, matched by transaction ID)`,
        [...cited, documentRef(reloaded.id)],
      )
    }

    const evidence = [...earlier, ...later].map(hitRef)
    if (earlier.some((hit) => transactionId(hit) === undefined))
      return inconclusive(
        id,
        "a purchase before the reload carried no transaction ID, so a repeat cannot be told from a new order",
        evidence,
      )
    if (later.some((hit) => transactionId(hit) === undefined))
      return inconclusive(
        id,
        "a purchase after the reload carried no transaction ID, so it cannot be matched to the earlier ones",
        evidence,
      )
    if (later.length > 0)
      return inconclusive(
        id,
        "a purchase after the reload matched no earlier one: a new transaction ID cannot be told from another order or from regenerated tracking data",
        evidence,
      )
    return pass(
      id,
      `${count(earlier.length, "Google purchase")} before the reload, each with a transaction ID, and none sent after it`,
      evidence,
    )
  },
}
