import {
  consentTimeline,
  googleConsentFromCcm,
  isDenied,
  isGoogle,
  withoutConsent,
} from "../../consent-state.js"
import { count, hitRef, requestRef } from "../../documents.js"
import { fail, inconclusive, nonEmpty, notApplicable, pass } from "../../results.js"
import type { EvidenceRef, Rule } from "../../types.js"

const id = "consent.google-without-denied-state"

export const googleWithoutDeniedState: Rule = {
  id,
  area: "consent",
  severity: "critical",
  title: "Tag fired before consent default",
  why: "With Consent Mode, a Google tag may send cookieless pings before consent, but only when they say storage is denied (gcs=G100). A GA4 or Google Ads hit, or a Consent Mode ping, with no consent state or a granted one before the visitor chooses means Google treats the visit as consented: it may set cookies and use the data for ads.",
  fix: [
    "Push gtag('consent', 'default', { ad_storage: 'denied', analytics_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' }) before the Google tag loads, above the gtag.js snippet or in Google Tag Manager's Consent Initialization trigger.",
    "Do not set a granted default for regions where consent is required; if your banner restores a stored choice, send it as gtag('consent', 'update', …) only once the stored choice is read.",
    "Check that nothing sends GA4 or Ads hits outside the Google tag (a hard-coded Measurement Protocol call, an old analytics.js snippet).",
  ],
  evaluate(input) {
    const timeline = consentTimeline(input)
    if (timeline.kind === "inconclusive") return inconclusive(id, timeline.reason)
    const hits = input.hits.filter((hit) => isGoogle(hit.vendor))
    const pings = input.capture.requests.flatMap((request) => {
      const consent = googleConsentFromCcm(request)
      return consent === null ? [] : [{ request, consent }]
    })
    if (hits.length === 0 && pings.length === 0)
      return notApplicable(id, "no Google hit or Consent Mode ping was sent")

    const badHits = hits.filter(
      (hit) => withoutConsent(input, hit.startedAt) && !isDenied(hit.consent),
    )
    const badPings = pings.filter(
      ({ request, consent }) => withoutConsent(input, request.startedAt) && !isDenied(consent),
    )
    const evidence = nonEmpty<EvidenceRef>([
      ...badHits.map(hitRef),
      ...badPings.map(({ request }) => requestRef(request.id)),
    ])
    const when = timeline.kind === "action" ? "before the consent action" : "with no consent given"
    if (evidence === null)
      return pass(id, `every Google hit and ping ${when} said storage was denied`)

    const states = [...badHits.map((hit) => hit.consent), ...badPings.map((ping) => ping.consent)]
    const missing = states.filter(
      (state) => state.adStorage === "unknown" && state.analyticsStorage === "unknown",
    ).length
    const parts = [
      missing > 0 ? `${missing} with no consent state` : null,
      missing < states.length ? `${states.length - missing} with a granted one` : null,
    ].filter((part) => part !== null)
    const what = [
      badHits.length > 0 ? count(badHits.length, "Google hit") : null,
      badPings.length > 0 ? count(badPings.length, "Consent Mode ping") : null,
    ]
      .filter((part) => part !== null)
      .join(" and ")
    return fail(id, `${what} ${when}: ${parts.join(", ")}`, evidence)
  },
}
