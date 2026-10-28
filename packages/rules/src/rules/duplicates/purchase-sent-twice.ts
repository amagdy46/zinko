import { count, groupBy, hitRef, vendorName } from "../../documents.js"
import { isPurchase, transactionId } from "../../purchases.js"
import { fail, nonEmpty, notApplicable, pass } from "../../results.js"
import { withoutRetransmissions } from "../../retransmissions.js"
import type { DecodedHit, Rule } from "../../types.js"

const id = "duplicates.purchase-sent-twice"

/**
 * Which hits are the same purchase. GA4 and Google Ads carry an order id; Ads also a conversion
 * label, so different labels are never duplicates of each other. Meta and TikTok send no order id,
 * so their purchases on one document are the same purchase.
 */
function purchaseKey(hit: DecodedHit): string {
  const order = transactionId(hit) ?? "(no transaction_id)"
  const label = hit.vendor === "google-ads" ? String(hit.params.label ?? "") : ""
  const which = hit.vendor === "ga4" || hit.vendor === "google-ads" ? order : hit.event
  // A purchase sent once to Google and once to a first-party collector is duplicates.client-and-server-ga4's.
  return [hit.documentId, hit.vendor, hit.collector ?? "", hit.destinationId, label, which].join(
    " ",
  )
}

/**
 * gtag sends one Ads conversion twice under Consent Mode: to googlesyndication with ad storage
 * denied, and to googleadservices once it is granted. Each such denied/granted couple is one
 * purchase, matched one to one; anything beyond the couples is a repeat.
 */
function adsPairs(hits: readonly [DecodedHit, ...DecodedHit[]]): number {
  if (hits[0].vendor !== "google-ads") return 0
  const denied = hits.filter(
    (hit) => hit.host === "pagead2.googlesyndication.com" && hit.consent.adStorage === "denied",
  ).length
  const granted = hits.filter(
    (hit) => /(^|\.)googleadservices\.com$/.test(hit.host) && hit.consent.adStorage === "granted",
  ).length
  return Math.min(denied, granted)
}

export const purchaseSentTwice: Rule = {
  id,
  area: "duplicates",
  severity: "critical",
  title: "Likely overcounting: purchase sent more than once",
  checkTitle: "Purchase sent once",
  why: "A purchase sent twice from one page is counted twice: revenue, conversions and ROAS are inflated, and Google Ads and Meta bid on conversions that never happened. GA4 and Ads drop repeats only when they carry the same transaction ID and arrive within their deduplication rules, and Meta and TikTok purchases carry no order id at all.",
  fix: [
    "Fire the purchase once per order: find the second trigger (a tag on both page load and a dataLayer event, a hard-coded gtag call next to a tag manager tag, or a confirmation page that re-renders).",
    "Guard the confirmation page so a reload does not send the purchase again (mark the order as tracked on the server or in storage).",
    "Always send the order's transaction_id, so GA4 and Google Ads can drop the repeats that still get through.",
  ],
  evaluate(input) {
    const purchases = withoutRetransmissions(input, input.hits.filter(isPurchase))
    if (purchases.length === 0) return notApplicable(id, "no purchase was sent")
    const groups = [...groupBy(purchases, purchaseKey).values()].map((hits) => {
      const pairs = adsPairs(hits)
      return { hits, pairs, sends: hits.length - pairs }
    })
    const repeated = groups.filter((group) => group.sends > 1)
    const evidence = nonEmpty(repeated.flatMap((group) => group.hits.map(hitRef)))
    if (evidence === null) {
      const pairs = groups.reduce((sum, group) => sum + group.pairs, 0)
      const note =
        pairs > 0
          ? ` (${count(pairs, "Google Ads denied/granted conversion pair")} counted as one purchase each)`
          : ""
      return pass(id, `${count(groups.length, "purchase")} sent once each${note}`)
    }
    const what = repeated
      .map((group) => {
        const [first] = group.hits
        const order = transactionId(first)
        const name = `${vendorName(first.vendor)} ${order ?? first.event}`
        return `${name} ${group.sends} times`
      })
      .join("; ")
    return fail(id, `the same purchase was sent more than once on one document: ${what}`, evidence)
  },
}
