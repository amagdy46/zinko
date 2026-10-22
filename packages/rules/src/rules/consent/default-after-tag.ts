import { consentTimeline, isCcmRequest, isGoogle } from "../../consent-state.js"
import {
  count,
  distinct,
  documentRef,
  hitRef,
  isGtagCommand,
  pushRef,
  pushesByDocument,
} from "../../documents.js"
import { fail, inconclusive, nonEmpty, notApplicable, pass } from "../../results.js"
import type { DecodedHit, EvidenceRef, Rule } from "../../types.js"

const id = "consent.default-after-tag"

export const defaultAfterTag: Rule = {
  id,
  area: "consent",
  severity: "warning",
  title: "Consent default set after the Google tag",
  why: "Consent Mode applies the default to whatever the Google tag does after it. A tag configured, or a hit sent, before gtag('consent', 'default', …) runs without any consent state, so Google may treat the visit as consented, and the first page_view carries no consent signal.",
  fix: [
    "Move the gtag('consent', 'default', …) call above the gtag.js snippet and every gtag('config', …) call, in the page's <head>.",
    "With Google Tag Manager, set the default from a tag on the Consent Initialization trigger (your banner's template or the Consent Mode template), which runs before every other trigger.",
    "If the banner script sets the default, load it synchronously before the Google tag rather than async or deferred.",
  ],
  evaluate(input) {
    const timeline = consentTimeline(input)
    if (timeline.kind === "inconclusive") return inconclusive(id, timeline.reason)
    const pushes = pushesByDocument(input)
    const documentIds = [
      ...new Set([
        ...input.capture.documents.map((doc) => doc.id),
        ...pushes.keys(),
        ...input.hits.map((hit) => hit.documentId),
      ]),
    ]
    const problems: { reason: string; evidence: EvidenceRef[] }[] = []
    let tagged = 0
    for (const documentId of documentIds) {
      const list = pushes.get(documentId) ?? []
      const config = list.find((push) => isGtagCommand(push, "config"))
      const firstHit = input.hits
        .filter((hit) => hit.documentId === documentId && isGoogle(hit.vendor))
        .reduce<DecodedHit | undefined>(
          (first, hit) => (first === undefined || hit.startedAt < first.startedAt ? hit : first),
          undefined,
        )
      const pinged = input.capture.requests.some(
        (request) => request.documentId === documentId && isCcmRequest(request),
      )
      if (config === undefined && firstHit === undefined && !pinged) continue
      tagged += 1
      const consentDefault = list.find((push) => isGtagCommand(push, "consent", "default"))
      if (consentDefault === undefined) {
        problems.push({
          reason: "no consent default was pushed",
          evidence: [
            documentRef(documentId),
            ...(config ? [pushRef(config)] : []),
            ...(firstHit ? [hitRef(firstHit)] : []),
          ],
        })
      } else if (config !== undefined && config.seq < consentDefault.seq) {
        problems.push({
          reason: "the consent default was pushed after the first config",
          evidence: [pushRef(consentDefault), pushRef(config)],
        })
      } else if (firstHit !== undefined && firstHit.startedAt < consentDefault.at) {
        problems.push({
          reason: `the first Google hit (${firstHit.vendor} ${firstHit.event}) was sent before the consent default`,
          evidence: [pushRef(consentDefault), hitRef(firstHit)],
        })
      }
    }
    if (tagged === 0) return notApplicable(id, "no document loads a Google tag")
    const evidence = nonEmpty(problems.flatMap((problem) => problem.evidence))
    if (evidence === null)
      return pass(
        id,
        `the consent default came first on ${count(tagged, "document")} with Google tags`,
      )
    const reasons = distinct(problems.map((problem) => problem.reason)).join("; ")
    const where = documentIds.length > 1 ? ` (${count(problems.length, "document")})` : ""
    return fail(id, `${reasons}${where}`, evidence)
  },
}
