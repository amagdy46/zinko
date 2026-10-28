import { count, distinct, hitRef } from "../../documents.js"
import { fail, nonEmpty, notApplicable, pass } from "../../results.js"
import type { Rule } from "../../types.js"

const id = "dedup.tiktok-eventid-missing"

/**
 * TikTok's standard events as they appear on the wire: the pixel sends `CompletePayment` as
 * `Purchase`. `Pageview` is left out, as Meta's `PageView` is.
 */
const STANDARD_EVENTS = new Set([
  "AddPaymentInfo",
  "AddToCart",
  "AddToWishlist",
  "ClickButton",
  "CompletePayment",
  "CompleteRegistration",
  "Contact",
  "Download",
  "InitiateCheckout",
  "PlaceAnOrder",
  "Purchase",
  "Search",
  "SubmitForm",
  "Subscribe",
  "ViewContent",
])

export const tiktokEventIdMissing: Rule = {
  id,
  area: "dedup",
  severity: "warning",
  owner: "developer",
  title: "TikTok event sent without an event ID",
  checkTitle: "TikTok events carry an event ID",
  why: "TikTok merges a browser event with the same event from its Events API only when both carry the same event name and event ID. Without one, an event sent both ways is counted twice, so conversions and their value are overstated. Zinko sees the browser side only: it cannot tell whether the Events API is also in use.",
  fix: [
    "Pass an event_id with every TikTok standard event: ttq.track('CompletePayment', { … }, { event_id: '<order id>' }), or the Event ID field of the tag manager's TikTok tag.",
    "If the Events API is used as well, send the same event_id and event name with the matching server event, so TikTok keeps one of the two.",
  ],
  evaluate(input) {
    const tiktok = input.hits.filter((hit) => hit.vendor === "tiktok")
    if (tiktok.length === 0) return notApplicable(id, "no TikTok hit was sent")
    const standard = tiktok.filter((hit) => STANDARD_EVENTS.has(hit.event))
    const missing = standard.filter((hit) => !hit.ids.eventId)
    const evidence = nonEmpty(missing.map(hitRef))
    if (evidence === null) {
      return pass(
        id,
        standard.length === 0
          ? "No TikTok standard event that needs an event ID was sent"
          : `${count(standard.length, "TikTok standard event")} carried an event ID`,
      )
    }
    const events = distinct(missing.map((hit) => hit.event)).join(", ")
    return fail(
      id,
      `${count(missing.length, "TikTok event")} (${events}) without an event ID`,
      evidence,
    )
  },
}
