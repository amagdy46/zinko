import { consentTimeline, googleConsentFromCcm, isGoogle } from "../../consent-state.js"
import {
  count,
  distinct,
  documentRef,
  hitRef,
  isGtagCommand,
  pushRef,
  pushesByDocument,
  requestRef,
} from "../../documents.js"
import { fail, inconclusive, nonEmpty, notApplicable, pass } from "../../results.js"
import type { EvidenceRef, Rule } from "../../types.js"

const id = "consent.default-after-tag"

/** The first thing a Google tag sent from a document: a decoded hit or a Consent Mode ping. */
interface GoogleSignal {
  label: string
  startedAt: number
  /** It said something about consent (a decoded state, or a `gcs` on the ping). */
  carriesState: boolean
  ref: EvidenceRef
}

interface Problem {
  verdict: "fail" | "inconclusive"
  reason: string
  evidence: EvidenceRef[]
}

export const defaultAfterTag: Rule = {
  id,
  area: "consent",
  severity: "warning",
  owner: "tag-manager",
  title: "Consent default set after the Google tag",
  checkTitle: "Consent default is set before Google tags",
  why: "Consent Mode applies the default to whatever the Google tag does after it. A tag configured, or a hit sent, before the consent default is set runs without any consent state, so Google may treat the visit as consented, and the first page_view carries no consent signal.",
  fix: [
    "With gtag.js on the page, move the gtag('consent', 'default', …) call above the gtag.js snippet and every gtag('config', …) call, in the page's <head>.",
    "With Google Tag Manager, set the default from a tag on the Consent Initialization trigger (your banner's template or the Consent Mode template), and make sure no Google tag fires on an earlier trigger or from a hard-coded snippet outside the container.",
    "If the banner script sets the default, load it synchronously before the Google tag rather than async or deferred.",
  ],
  evaluate(input) {
    const timeline = consentTimeline(input)
    if (timeline.kind === "inconclusive") return inconclusive(id, timeline.reason)
    const pushes = pushesByDocument(input)
    const documentIds = distinct([
      ...input.capture.documents.map((doc) => doc.id),
      ...pushes.keys(),
      ...input.hits.map((hit) => hit.documentId),
    ])
    const problems: Problem[] = []
    let tagged = 0
    for (const documentId of documentIds) {
      const list = pushes.get(documentId) ?? []
      const config = list.find((push) => isGtagCommand(push, "config"))
      const signals: GoogleSignal[] = [
        ...input.hits
          .filter((hit) => hit.documentId === documentId && isGoogle(hit.vendor))
          .map((hit) => ({
            label: `${hit.vendor} ${hit.event}`,
            startedAt: hit.startedAt,
            carriesState:
              hit.consent.adStorage !== "unknown" || hit.consent.analyticsStorage !== "unknown",
            ref: hitRef(hit),
          })),
        ...input.capture.requests.flatMap((request) => {
          const consent = request.documentId === documentId ? googleConsentFromCcm(request) : null
          return consent === null
            ? []
            : [
                {
                  label: "Consent Mode ping",
                  startedAt: request.startedAt,
                  carriesState: consent.raw !== undefined,
                  ref: requestRef(request.id),
                },
              ]
        }),
      ]
      const first = signals.reduce<GoogleSignal | undefined>(
        (earliest, signal) =>
          earliest === undefined || signal.startedAt < earliest.startedAt ? signal : earliest,
        undefined,
      )
      if (config === undefined && first === undefined) continue
      tagged += 1
      const consentDefault = list.find((push) => isGtagCommand(push, "consent", "default"))
      if (consentDefault === undefined) {
        // Google Tag Manager's consent templates set the default through its consent API
        // (setDefaultConsentState), which never reaches dataLayer. A first hit that already carries
        // a consent state is what such a default looks like, so it is not proof of a missing one.
        if (first === undefined) {
          problems.push({
            verdict: "inconclusive",
            reason:
              "no consent default in dataLayer and no Google hit to read the consent state from",
            evidence: [documentRef(documentId), ...(config ? [pushRef(config)] : [])],
          })
        } else if (first.carriesState) {
          problems.push({
            verdict: "inconclusive",
            reason: `no consent default in dataLayer, but the first Google hit (${first.label}) carried a consent state, so the default may be set through Google Tag Manager's consent API`,
            evidence: [first.ref],
          })
        } else {
          problems.push({
            verdict: "fail",
            reason: `no consent default was set: the first Google hit (${first.label}) carried no consent state`,
            evidence: [documentRef(documentId), first.ref, ...(config ? [pushRef(config)] : [])],
          })
        }
      } else if (config !== undefined && config.seq < consentDefault.seq) {
        problems.push({
          verdict: "fail",
          reason: "the consent default was pushed after the first config",
          evidence: [pushRef(consentDefault), pushRef(config)],
        })
      } else if (first !== undefined && first.startedAt < consentDefault.at) {
        problems.push({
          verdict: "fail",
          reason: `the first Google hit (${first.label}) was sent before the consent default`,
          evidence: [pushRef(consentDefault), first.ref],
        })
      }
    }
    if (tagged === 0) return notApplicable(id, "no document loads a Google tag")
    const where = (n: number) => (documentIds.length > 1 ? ` (${count(n, "document")})` : "")
    const failures = problems.filter((problem) => problem.verdict === "fail")
    const evidence = nonEmpty(failures.flatMap((problem) => problem.evidence))
    if (evidence !== null) {
      const reasons = distinct(failures.map((problem) => problem.reason)).join("; ")
      return fail(id, `${reasons}${where(failures.length)}`, evidence)
    }
    if (problems.length > 0) {
      const reasons = distinct(problems.map((problem) => problem.reason)).join("; ")
      return inconclusive(
        id,
        `${reasons}${where(problems.length)}`,
        problems.flatMap((problem) => problem.evidence),
      )
    }
    return pass(
      id,
      `the consent default came first on ${count(tagged, "document")} with Google tags`,
    )
  },
}
