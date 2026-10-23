import { count, distinct, hitRef, vendorName } from "../../documents.js"
import { isPurchase } from "../../purchases.js"
import { fail, nonEmpty, notApplicable, pass } from "../../results.js"
import type { Rule } from "../../types.js"

const id = "coverage.invalid-currency"

const ISO_4217 = /^[A-Z]{3}$/

export const invalidCurrency: Rule = {
  id,
  area: "coverage",
  severity: "warning",
  title: "Purchase currency is not an ISO 4217 code",
  checkTitle: "Purchase currency is an ISO 4217 code",
  why: "GA4, Google Ads, Meta and TikTok expect the currency as a three-letter uppercase ISO 4217 code (EUR, USD). Anything else, such as a lowercase code or a symbol, is rejected or reported without revenue, so the purchase's value is lost or converted wrongly.",
  fix: [
    "Send the currency as a three-letter uppercase code (EUR, not eur or €), from the order data on the confirmation page or the dataLayer push.",
    "If the shop platform returns lowercase codes, uppercase them in the tag manager variable that feeds the purchase tags.",
  ],
  evaluate(input) {
    const priced = input.hits.filter(
      (hit) => isPurchase(hit) && hit.params.currency !== undefined && hit.params.currency !== "",
    )
    if (priced.length === 0) return notApplicable(id, "no purchase carried a currency")
    const invalid = priced.filter((hit) => !ISO_4217.test(String(hit.params.currency)))
    const evidence = nonEmpty(invalid.map(hitRef))
    if (evidence === null)
      return pass(id, `${count(priced.length, "purchase hit")} sent a valid currency code`)
    const what = distinct(
      invalid.map((hit) => `${vendorName(hit.vendor)} "${String(hit.params.currency)}"`),
    ).join(", ")
    return fail(
      id,
      `${count(invalid.length, "purchase hit")} with an invalid currency: ${what}`,
      evidence,
    )
  },
}
