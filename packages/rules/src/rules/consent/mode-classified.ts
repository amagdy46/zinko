import {
  consentTimeline,
  googleConsentFromCcm,
  isGoogle,
  withoutConsent,
} from "../../consent-state.js"
import { count, hitRef, isGtagCommand, pushesByDocument, requestRef } from "../../documents.js"
import { inconclusive, nonEmpty, notApplicable, pass } from "../../results.js"
import type { EvidenceRef, Rule } from "../../types.js"

const id = "consent.mode-classified"

interface Signal {
  documentId: string
  startedAt: number
  denied: boolean
  granted: boolean
  ref: EvidenceRef
}

export const modeClassified: Rule = {
  id,
  area: "consent",
  severity: "info",
  title: "Consent Mode type",
  checkTitle: "Consent Mode type is known",
  why: "Consent Mode has two modes. In advanced mode the Google tag loads before consent and sends cookieless pings that say storage is denied; Google uses them to model conversions it cannot observe. In basic mode the tag does not load until the visitor consents, so no ping is sent and Google has nothing to model from. Neither is a defect: the mode explains why modelled conversions are present or missing, and it is a choice to make knowingly. This check never fails.",
  fix: [
    "To move from basic to advanced, load the Google tag at page load with the consent default (all four types denied) set before it, and send a consent update when the visitor chooses.",
    "To move from advanced to basic, do not load the Google tag or the Tag Manager container until the visitor consents. Check with your privacy adviser which your regime requires.",
  ],
  evaluate(input) {
    const timeline = consentTimeline(input)
    if (timeline.kind === "inconclusive") return inconclusive(id, timeline.reason)

    const signals: Signal[] = [
      ...input.hits
        .filter((hit) => isGoogle(hit.vendor))
        .map((hit) => ({
          documentId: hit.documentId,
          startedAt: hit.startedAt,
          denied: hit.consent.adStorage === "denied" || hit.consent.analyticsStorage === "denied",
          granted:
            hit.consent.adStorage === "granted" || hit.consent.analyticsStorage === "granted",
          ref: hitRef(hit),
        })),
      ...input.capture.requests.flatMap((request) => {
        const consent = googleConsentFromCcm(request)
        return consent === null
          ? []
          : [
              {
                documentId: request.documentId,
                startedAt: request.startedAt,
                denied: consent.adStorage === "denied" || consent.analyticsStorage === "denied",
                granted: consent.adStorage === "granted" || consent.analyticsStorage === "granted",
                ref: requestRef(request.id),
              },
            ]
      }),
    ]

    if (signals.length === 0) {
      const defaulted = [...pushesByDocument(input).values()].some((pushes) =>
        pushes.some((push) => isGtagCommand(push, "consent", "default")),
      )
      const loaded = input.capture.requests.some(
        (request) =>
          URL.canParse(request.url) && /\/(gtag\/js|gtm\.js)$/.test(new URL(request.url).pathname),
      )
      if (!defaulted && !loaded) return notApplicable(id, "no Google tag or request was seen")
      return inconclusive(
        id,
        "no Google request was sent in this scenario: a site that holds its Google tag until consent (basic mode) and one without the tag look the same here",
      )
    }

    const before = signals.filter((signal) => withoutConsent(input, signal.startedAt))
    const denied = before.filter((signal) => signal.denied)
    const evidence = nonEmpty<EvidenceRef>(denied.map((signal) => signal.ref))
    if (evidence !== null) {
      // Denied is the pre-choice state only if it holds: a granted request later in the same
      // document, before any action, means a default (often per region) flipped without a choice.
      const flipped = before.filter((signal) =>
        denied.some(
          (first) =>
            first.documentId === signal.documentId &&
            first.startedAt < signal.startedAt &&
            signal.granted,
        ),
      )
      if (flipped.length > 0)
        return inconclusive(
          id,
          "Consent was denied by default, then granted without a visitor choice (a region-based default?)",
          [...denied, ...flipped].map((signal) => signal.ref),
        )
      const other = before.length - denied.length
      const note =
        other > 0
          ? `; ${count(other, "other request")} had no denied state (see consent.google-without-denied-state)`
          : ""
      return pass(
        id,
        `advanced mode: ${count(denied.length, "Google request")} sent before consent said storage was denied${note}`,
        evidence,
      )
    }
    if (before.length === 0)
      return pass(
        id,
        "basic mode: no Google request was sent before the visitor's choice, the first came after it",
        signals.slice(0, 1).map((signal) => signal.ref),
      )
    return inconclusive(
      id,
      `${count(before.length, "Google request")} sent before consent carried no denied state, so the mode could not be told`,
      before.map((signal) => signal.ref),
    )
  },
}
