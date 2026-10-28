import { count, distinct, hitRef, vendorName } from "../../documents.js"
import { isPurchase, missingFields } from "../../purchases.js"
import { fail, nonEmpty, notApplicable, pass } from "../../results.js"
import type { Rule } from "../../types.js"

const id = "coverage.purchase-missing-fields"

export const purchaseMissingFields: Rule = {
  id,
  area: "coverage",
  severity: "critical",
  owner: "developer",
  title: "Purchase missing transaction ID, value or currency",
  checkTitle: "Purchase carries transaction ID, value and currency",
  why: "Revenue reports, ROAS and conversion value bidding read the value and currency of every purchase, and GA4 and Google Ads use the transaction ID to drop repeated purchases. A purchase without them is counted with no revenue, in the wrong currency, or once per page reload.",
  fix: [
    "Send transaction_id, value and currency with the GA4 purchase event, from the order on the confirmation page (or the dataLayer purchase push your tag manager reads).",
    "Pass the same transaction_id, value and currency to the Google Ads conversion tag (send_to with the conversion label), so Ads can deduplicate conversions.",
    "Send value and currency with the Meta and TikTok Purchase events.",
  ],
  evaluate(input) {
    const purchases = input.hits.filter(isPurchase)
    if (purchases.length === 0) return notApplicable(id, "no purchase was sent")
    const incomplete = purchases.flatMap((hit) => {
      const missing = missingFields(hit)
      return missing.length === 0 ? [] : [{ hit, missing }]
    })
    const evidence = nonEmpty(incomplete.map(({ hit }) => hitRef(hit)))
    if (evidence === null)
      return pass(id, `${count(purchases.length, "purchase hit")} carried every required field`)
    const what = distinct(
      incomplete.map(
        ({ hit, missing }) => `${vendorName(hit.vendor)} without ${missing.join(", ")}`,
      ),
    ).join("; ")
    return fail(id, `${count(incomplete.length, "purchase hit")}: ${what}`, evidence)
  },
}
