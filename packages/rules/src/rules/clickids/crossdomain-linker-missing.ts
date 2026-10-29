import { consentTimeline } from "../../consent-state.js"
import { documentRef, hitRef } from "../../documents.js"
import { destinationLabeler } from "../../event-names.js"
import {
  combineArrivals,
  fail,
  inconclusive,
  nonEmpty,
  notApplicable,
  pass,
} from "../../results.js"
import { hitState } from "../../settled-signals.js"
import type { CapturedDocument } from "@repo/capture-contract"
import type { CheckResult, DecodedHit, EvidenceRef, Rule } from "../../types.js"

const id = "clickid.crossdomain-linker-missing"

const CUT_SHORT: ReadonlySet<string> = new Set([
  "JourneyStep",
  "Timeout",
  "Navigation",
  "EngineFailure",
])

const hostOf = (url: string) => (URL.canParse(url) ? new URL(url).hostname.replace(/\.$/, "") : "")
const hasLinker = (url: string) => URL.canParse(url) && new URL(url).searchParams.has("_gl")

/** The client ids of the hits of one destination that were sent with analytics storage granted. */
function eligible(hits: readonly DecodedHit[]) {
  const sent = hits.filter((hit) => hitState(hit, "analytics_storage") === "granted")
  return {
    sent,
    ids: new Set(sent.flatMap((hit) => (hit.ids.clientId === undefined ? [] : [hit.ids.clientId]))),
  }
}

export const crossdomainLinkerMissing: Rule = {
  id,
  area: "clickids",
  severity: "warning",
  owner: "tag-manager",
  title: "Visitor counted as a new user on the site's other host",
  checkTitle: "Analytics identity carried to the site's other hosts",
  why: "When a visitor follows a link from one of your hosts to another, Google Analytics needs the cross-domain linker to recognise them there. Without it the visitor becomes a new user and a new session: users are overcounted, the traffic source of the visit is lost, and a purchase on the other host is credited to direct traffic instead of the ad or campaign that brought them.",
  fix: [
    "In the Google tag settings, add every host of the site (the checkout, the shop, the blog) to the cross-domain linker's domains, on every host.",
    "Check that the destination accepts incoming linker parameters (accept_incoming is not false) and that no script removes the _gl parameter before the tag reads it.",
    "If the other host is a payment or booking provider you do not control, ask for its linker domain or move the step onto your own host.",
  ],
  evaluate(input) {
    if (input.scenario === "none" || input.scenario === "gpc")
      return notApplicable(id, "no consent choice was made in this scenario")
    if (!input.journey) return notApplicable(id, "only checked on cross-host runs")
    const { documents, errors } = input.capture
    const [first] = documents
    if (first?.navigation === undefined)
      return inconclusive(
        id,
        "this capture predates reload and follow metadata, so how each page was reached is unknown",
      )
    const arrivals = documents.filter((document) => document.navigation === "follow")
    const cut = errors.find((error) => CUT_SHORT.has(error.code))
    if (arrivals.length === 0)
      return cut === undefined
        ? notApplicable(id, "no link to another host was followed")
        : inconclusive(id, `the run did not reach another host (${cut.code})`)
    const timeline = consentTimeline(input)
    if (timeline.kind !== "action")
      return inconclusive(
        id,
        timeline.kind === "inconclusive" ? timeline.reason : "the consent action did not run",
      )
    if (timeline.outcome !== "accepted")
      return notApplicable(id, "only checked after the visitor accepted")
    const judge = (arrival: CapturedDocument, position: number): CheckResult => {
      const host = hostOf(arrival.url)
      const where = `later host ${position + 1}`
      if (!input.measuredHosts.includes(host))
        return inconclusive(
          id,
          input.measuredHosts.length === 0
            ? `arrived at ${where}, and no other host is declared for the site`
            : `arrived at ${where}, which is not a declared host`,
          [documentRef(arrival.id)],
        )

      const ga4 = input.hits.filter((hit) => hit.vendor === "ga4")
      const destinations = [
        ...new Set(
          ga4.filter((hit) => hit.documentId === first.id).map((hit) => hit.destinationId),
        ),
      ]
      if (destinations.length === 0)
        return inconclusive(id, "no Google Analytics 4 hit was sent on the first host", [
          documentRef(first.id),
        ])

      const linked = [arrival.url, ...arrival.redirects].some(hasLinker)
      const failures: string[] = []
      const unresolved: string[] = []
      const evidence: EvidenceRef[] = []
      const passed: string[] = []
      const labelOf = destinationLabeler(destinations)
      for (const destination of destinations) {
        const label = labelOf(destination)
        const of = (documentId: string) =>
          ga4.filter((hit) => hit.documentId === documentId && hit.destinationId === destination)
        const before = eligible(of(first.id))
        const after = eligible(of(arrival.id))
        if (before.sent.length === 0) {
          unresolved.push(`${label}: analytics storage was not granted on the first host`)
        } else if (of(arrival.id).length === 0) {
          unresolved.push(`${label}: no hit on ${where}`)
        } else if (after.sent.length === 0) {
          unresolved.push(`${label}: analytics storage was not granted on ${where}`)
        } else if (before.ids.size !== 1 || after.ids.size !== 1) {
          unresolved.push(`${label}: no single client id on one of the hosts`)
        } else if ([...before.ids][0] === [...after.ids][0]) {
          passed.push(label)
        } else {
          const [seen] = before.sent
          const [arrived] = after.sent
          if (seen !== undefined) evidence.push(hitRef(seen))
          if (arrived !== undefined) evidence.push(hitRef(arrived))
          failures.push(
            linked
              ? `${label}: the link carried a linker parameter but ${where} did not adopt it`
              : `${label}: the visitor was counted as a new user on ${where}, with no linker parameter on the link`,
          )
        }
      }
      const refs = [documentRef(first.id), documentRef(arrival.id)]
      const cited = nonEmpty([...refs, ...evidence])
      if (cited !== null && failures.length > 0) return fail(id, failures.join("; "), cited)
      if (unresolved.length > 0)
        return inconclusive(id, `could not compare ${unresolved.join("; ")}`, refs)
      return pass(id, `the client id carried over to ${where} for ${passed.join(", ")}`, refs)
    }
    // every followed link is judged: a failure on any of them fails the run
    return combineArrivals(
      id,
      arrivals.map((arrival, position) => judge(arrival, position)),
    )
  },
}
