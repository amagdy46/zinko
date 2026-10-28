import { consentTimeline } from "../../consent-state.js"
import { cookieRef, isAdOrAnalyticsCookie, snapshotsLabelled } from "../../cookies.js"
import { distinct } from "../../documents.js"
import { fail, inconclusive, nonEmpty, pass } from "../../results.js"
import type { Rule } from "../../types.js"

const id = "consent.cookies-without-consent"

export const cookiesWithoutConsent: Rule = {
  id,
  area: "consent",
  severity: "critical",
  owner: "consent-platform",
  title: "Ad or analytics cookies set without consent",
  checkTitle: "Ad and analytics cookies wait for consent",
  why: "Under the GDPR and the ePrivacy rules, cookies that track visitors for analytics or advertising need consent before they are set. A cookie written before the visitor chooses, or when they never choose, is the most visible kind of consent breach: anyone can see it in the browser.",
  fix: [
    "Load the Google tag with Consent Mode's default set to denied, before any tag runs, so gtag does not write _ga or _gcl_* cookies until consent is granted.",
    "Load the Meta and TikTok pixels only after the visitor accepts marketing cookies, from the consent banner's callback or a tag manager trigger on the consent update.",
    "Check other scripts that read or write these cookies (A/B testing, chat widgets, affiliate tags) and gate them on the same consent category.",
  ],
  evaluate(input) {
    const timeline = consentTimeline(input)
    if (timeline.kind === "inconclusive") return inconclusive(id, timeline.reason)
    // A cookie set and removed between two snapshots is not seen.
    const snapshots =
      timeline.kind === "action"
        ? snapshotsLabelled(input, "before-consent")
        : snapshotsLabelled(input, "document-end", "end")
    if (snapshots.length === 0) {
      const which = timeline.kind === "action" ? "before-consent" : "end"
      return inconclusive(id, `the run has no ${which} cookie snapshot`)
    }
    const found = snapshots.flatMap((snapshot) =>
      snapshot.cookies
        .filter((cookie) => isAdOrAnalyticsCookie(cookie.name))
        .map((cookie) => ({ name: cookie.name, ref: cookieRef(snapshot, cookie) })),
    )
    const evidence = nonEmpty(found.map((f) => f.ref))
    if (evidence === null) {
      return pass(
        id,
        timeline.kind === "action"
          ? "no ad or analytics cookie was set before the consent action"
          : "no ad or analytics cookie was set",
      )
    }
    const names = distinct(found.map((f) => f.name)).join(", ")
    if (timeline.kind === "action")
      return fail(id, `${names} set before the consent action`, evidence)
    const context =
      input.scenario === "gpc" ? "although the browser sent a GPC signal" : "with no consent given"
    return fail(id, `${names} set ${context}`, evidence)
  },
}
