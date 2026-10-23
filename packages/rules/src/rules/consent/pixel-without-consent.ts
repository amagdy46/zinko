import { consentTimeline, isNonGoogle, withoutConsent } from "../../consent-state.js"
import { count, distinct, hitRef } from "../../documents.js"
import { fail, inconclusive, nonEmpty, pass } from "../../results.js"
import type { Rule } from "../../types.js"

const id = "consent.pixel-without-consent"

export const pixelWithoutConsent: Rule = {
  id,
  area: "consent",
  severity: "critical",
  title: "Ad pixel fired without consent",
  checkTitle: "Ad pixels wait for consent",
  why: "Meta and TikTok pixels carry no consent signal of their own: once one fires, the visit has been shared with the ad platform. A pixel that fires before the visitor chooses, when they never choose, or despite a Global Privacy Control signal, shares personal data without a legal basis.",
  fix: [
    "Load the Meta and TikTok pixels only after the visitor accepts marketing cookies: from the consent banner's callback, or a tag manager trigger on the consent update, never on page load.",
    "If the pixel must load early, use its own consent API (fbq('consent', 'revoke') before init, ttq.holdConsent()) and grant it only on acceptance.",
    "Treat a Global Privacy Control signal (navigator.globalPrivacyControl) as an opt-out of sale and sharing: do not load the pixels for that visitor.",
  ],
  evaluate(input) {
    const timeline = consentTimeline(input)
    if (timeline.kind === "inconclusive") return inconclusive(id, timeline.reason)
    const hits = input.hits.filter(
      (hit) => isNonGoogle(hit.vendor) && withoutConsent(input, hit.startedAt),
    )
    const evidence = nonEmpty(hits.map(hitRef))
    if (evidence === null) {
      return pass(
        id,
        timeline.kind === "action"
          ? "no Meta or TikTok hit before the consent action"
          : "no Meta or TikTok hit was sent",
      )
    }
    const what = `${count(hits.length, "hit")} (${distinct(hits.map((h) => `${h.vendor} ${h.event}`)).join(", ")})`
    if (timeline.kind === "action") return fail(id, `${what} before the consent action`, evidence)
    if (input.scenario === "gpc")
      return fail(id, `${what} despite the GPC signal: the GPC signal was ignored`, evidence)
    return fail(id, `${what} with no consent given`, evidence)
  },
}
