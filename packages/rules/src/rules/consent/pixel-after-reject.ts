import { consentTimeline, isNonGoogle } from "../../consent-state.js"
import { count, distinct, hitRef } from "../../documents.js"
import { fail, inconclusive, nonEmpty, notApplicable, pass } from "../../results.js"
import type { Rule } from "../../types.js"

const id = "consent.pixel-after-reject"

export const pixelAfterReject: Rule = {
  id,
  area: "consent",
  severity: "critical",
  title: "Ad pixel fired after the visitor rejected",
  why: "A visitor who rejects marketing cookies has refused to be shared with ad platforms. A Meta or TikTok hit after the rejection ignores that choice outright, which is the clearest consent breach a regulator or a visitor can find.",
  fix: [
    "Find what loads the pixel after the choice: a banner callback that runs on any choice, or a tag manager trigger on the consent update that does not check the marketing category.",
    "Fire the pixel only when the marketing category is granted, and do nothing on rejection.",
    "If the pixel was already loaded, revoke it on rejection (fbq('consent', 'revoke'), ttq.revokeConsent()).",
  ],
  evaluate(input) {
    if (input.scenario !== "reject")
      return notApplicable(id, "only checked when the visitor rejects")
    const timeline = consentTimeline(input)
    if (timeline.kind === "inconclusive") return inconclusive(id, timeline.reason)
    if (timeline.kind === "no-action") return inconclusive(id, "the reject action did not run")
    const { actionAt } = timeline
    const hits = input.hits.filter((hit) => isNonGoogle(hit.vendor) && hit.startedAt >= actionAt)
    const evidence = nonEmpty(hits.map(hitRef))
    if (evidence === null) return pass(id, "no Meta or TikTok hit after the rejection")
    const what = distinct(hits.map((h) => `${h.vendor} ${h.event}`)).join(", ")
    return fail(id, `${count(hits.length, "hit")} (${what}) after the rejection`, evidence)
  },
}
