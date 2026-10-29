import type { CapturedDocument, Cookie } from "@repo/capture-contract"
import { consentTimeline } from "../../consent-state.js"
import { consentCookieNames } from "../../cmp-storage.js"
import { readableByScriptOn } from "../../cookies.js"
import { documentRef } from "../../documents.js"
import {
  combineArrivals,
  fail,
  inconclusive,
  nonEmpty,
  notApplicable,
  pass,
} from "../../results.js"
import { revert, SIGNALS, settledState, signalEvents } from "../../settled-signals.js"
import type { Signal } from "../../settled-signals.js"
import type { CheckResult, EvidenceRef, Rule, RunInput } from "../../types.js"

const id = "consent.lost-across-subdomain"

const CUT_SHORT: ReadonlySet<string> = new Set([
  "JourneyStep",
  "Timeout",
  "Navigation",
  "EngineFailure",
])

const hostOf = (url: string) => (URL.canParse(url) ? new URL(url).hostname.replace(/\.$/, "") : "")

/** Why the visitor's consent cookie does not reach the arrival page, or `undefined` when it does. */
function unreachableBecause(cookie: Cookie, url: string): string | undefined {
  const { hostname, protocol } = new URL(url)
  const domain = cookie.domain.startsWith(".") ? cookie.domain.slice(1) : cookie.domain
  const hostMatches = cookie.domain.startsWith(".")
    ? hostname === domain || hostname.endsWith(cookie.domain)
    : hostname === domain
  if (!hostMatches) return "is limited to the first host"
  if (cookie.secure && protocol !== "https:") return "is limited to https"
  if (!readableByScriptOn({ ...cookie, httpOnly: false }, url))
    return "is limited to a path the arrival page is not under"
  return undefined
}

export const lostAcrossSubdomain: Rule = {
  id,
  area: "consent",
  severity: "warning",
  owner: "consent-platform",
  title: "Consent choice lost on the site's other host",
  checkTitle: "Consent choice kept on the site's other hosts",
  why: "A visitor who accepted cookies on one host of the site expects the choice to hold when a link takes them to another host the site owns, such as the checkout. When the banner asks again there, or the tags there go back to denied, the visitor is asked twice, tags measure with the wrong consent state and what you collect after an accept can be lost.",
  fix: [
    "Set the consent platform's cookie for the parent domain (every host of the site), not for one host, or use its multi-domain option.",
    "If the other host is a separate site with its own consent platform, point both at one shared configuration so a choice made on one applies to the other.",
    "Make the page on the other host push the stored choice to your tags before the Google tag sends its first request.",
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

      // the signals the choice granted, read at the end of the page it was made on
      const reference = documents.findLast((document) => document.startedAt <= timeline.actionAt)
      const required: readonly Signal[] =
        reference === undefined
          ? []
          : SIGNALS.filter(
              (signal) => settledState(signalEvents(input, reference.id, signal)) === "granted",
            )

      const failures: string[] = []
      const both = [documentRef(first.id), documentRef(arrival.id)]
      const evidence: EvidenceRef[] = [...both]
      const unresolved: string[] = []
      if (arrival.banner === "shown") failures.push(`the banner was shown again on ${where}`)
      else if (arrival.banner !== "hidden")
        unresolved.push(`whether the banner was shown on ${where}`)
      const reverted: Signal[] = []
      const unknown: Signal[] = []
      for (const signal of required) {
        const events = signalEvents(input, arrival.id, signal)
        const proof = revert(events)
        if (proof !== undefined) {
          reverted.push(signal)
          evidence.push(...proof)
        } else if (settledState(events) !== "granted") unknown.push(signal)
      }
      if (reverted.length > 0)
        failures.push(`${reverted.join(", ")} went back to denied on ${where}`)
      if (unknown.length > 0) unresolved.push(`${unknown.join(", ")} on ${where}`)

      const cited = nonEmpty([
        ...new Map(evidence.map((ref) => [JSON.stringify(ref), ref])).values(),
      ])
      if (cited !== null && failures.length > 0)
        return fail(
          id,
          `${failures.join("; ")} after the visitor accepted${cause(input, first.id, arrival.url, arrival.banner === "shown")}`,
          cited,
        )
      if (unresolved.length > 0)
        return inconclusive(id, `could not tell ${unresolved.join("; ")}`, both)
      const signals = required.length === 0 ? "" : ` and ${required.join(", ")} stayed granted`
      return pass(id, `the banner stayed hidden on ${where}${signals}`, both)
    }
    // every followed link is judged: a failure on any of them fails the run
    return combineArrivals(
      id,
      arrivals.map((arrival, position) => judge(arrival, position)),
    )
  },
}

/** A separate sentence about where the choice is stored; never part of the verdict, empty when it cannot be named. */
function cause(input: RunInput, firstId: string, arrivalUrl: string, bannerShown: boolean): string {
  const names = consentCookieNames(input.capture.consent.cmp)
  if (names === undefined) return ""
  const snapshot = input.capture.cookies.find(
    (candidate) => candidate.label === "document-end" && candidate.documentId === firstId,
  )
  const cookie = snapshot?.cookies.find((candidate) => names.includes(candidate.name))
  if (cookie === undefined || cookie.httpOnly) return ""
  const reason = unreachableBecause(cookie, arrivalUrl)
  if (reason !== undefined) return `. Its consent cookie ${reason}`
  return `. Its consent cookie is readable on the arrival host but ${bannerShown ? "the banner was still shown" : "the consent state was still denied"}`
}
