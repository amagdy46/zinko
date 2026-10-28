import { count, distinct, hitRef } from "../../documents.js"
import { fail, nonEmpty, notApplicable, pass } from "../../results.js"
import type { Rule } from "../../types.js"

const id = "dedup.meta-eventid-missing"

/** Meta's standard events, except PageView, which is rarely sent from the server as well. */
const STANDARD_EVENTS = new Set([
  "AddPaymentInfo",
  "AddToCart",
  "AddToWishlist",
  "CompleteRegistration",
  "Contact",
  "CustomizeProduct",
  "Donate",
  "FindLocation",
  "InitiateCheckout",
  "Lead",
  "Purchase",
  "Schedule",
  "Search",
  "StartTrial",
  "SubmitApplication",
  "Subscribe",
  "ViewContent",
])

export const metaEventIdMissing: Rule = {
  id,
  area: "dedup",
  severity: "warning",
  owner: "developer",
  title: "Meta event sent without an event ID",
  checkTitle: "Meta events carry an event ID",
  why: "Meta matches a browser event with the same event from the Conversions API by its event ID. Without one, an event sent both ways is counted twice, and Meta cannot tell which copy to keep, so conversions and their value are overstated.",
  fix: [
    "Pass an eventID with every Meta standard event: fbq('track', 'Purchase', { … }, { eventID: '<order id>' }), or the Event ID field of the tag manager's Meta tag.",
    "Send the same event ID with the matching Conversions API event, so Meta keeps one of the two.",
  ],
  evaluate(input) {
    const meta = input.hits.filter((hit) => hit.vendor === "meta")
    if (meta.length === 0) return notApplicable(id, "no Meta hit was sent")
    const standard = meta.filter((hit) => STANDARD_EVENTS.has(hit.event))
    const missing = standard.filter((hit) => !hit.ids.eventId)
    const evidence = nonEmpty(missing.map(hitRef))
    if (evidence === null) {
      return pass(
        id,
        standard.length === 0
          ? "no Meta standard event other than PageView was sent"
          : `${count(standard.length, "Meta standard event")} carried an event ID`,
      )
    }
    const events = distinct(missing.map((hit) => hit.event)).join(", ")
    return fail(
      id,
      `${count(missing.length, "Meta event")} (${events}) without an event ID`,
      evidence,
    )
  },
}
