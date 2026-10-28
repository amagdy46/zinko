import type { CapturedDocument } from "@repo/capture-contract"
import { consentTimeline } from "../../consent-state.js"
import { count, distinct, documentRef } from "../../documents.js"
import { fail, inconclusive, nonEmpty, notApplicable, pass } from "../../results.js"
import { revert, SIGNALS, settledState, signalEvents } from "../../settled-signals.js"
import type { Signal } from "../../settled-signals.js"
import type { EvidenceRef, Rule } from "../../types.js"

const id = "consent.not-persisted-across-navigation"

const CUT_SHORT: ReadonlySet<string> = new Set([
  "JourneyStep",
  "Timeout",
  "Navigation",
  "EngineFailure",
])

function pathOf(url: string): string {
  if (!URL.canParse(url)) return url
  return new URL(url).pathname
}

/** `/product` (reached by goto) or the reload of it, for a message. */
function describe(document: CapturedDocument): string {
  const path = pathOf(document.url)
  return document.navigation === "reload" ? `the reload of ${path}` : path
}

export const notPersistedAcrossNavigation: Rule = {
  id,
  area: "consent",
  severity: "warning",
  title: "Consent choice not kept on the next page",
  checkTitle: "Consent choice kept across pages and reloads",
  why: "A visitor who accepted or rejected the banner expects the site to remember it. When the banner comes back on the next page or after a reload, or the tags go back to their denied default, the choice was not kept: visitors are asked again, tags measure with the wrong consent state, and what you collect after an accept can be lost.",
  fix: [
    "Check that your consent platform stores the choice in a first-party cookie or storage that lasts across pages, and that nothing removes it on the next load (a cache or security plugin, a cookie-clearing script).",
    "Make the page push the stored choice to your tags on every load, before the Google tag sends its first request: gtag('consent', 'update', ...) with the saved values, or a consent platform that does it for you.",
    "If the banner returns on every page, look for a stored choice that is on another host or path than the page reads, or that expires at once.",
  ],
  evaluate(input) {
    if (input.scenario === "none" || input.scenario === "gpc")
      return notApplicable(id, "no consent choice was made in this scenario")
    if (!input.journey) return notApplicable(id, "only checked on journey runs")
    const timeline = consentTimeline(input)
    if (timeline.kind !== "action")
      return inconclusive(
        id,
        timeline.kind === "inconclusive" ? timeline.reason : "the consent action did not run",
      )
    const { documents } = input.capture
    if (documents[0]?.navigation === undefined)
      return inconclusive(
        id,
        "this capture predates reload and follow metadata, so how each page was reached is unknown",
      )
    const { actionAt, outcome } = timeline

    const later = documents.filter(
      (document) => document.navigation !== "start" && document.startedAt > actionAt,
    )
    if (later.length === 0) return notApplicable(id, "no page was loaded after the consent choice")

    // The signals the choice granted, read at the end of the page it was made on.
    const reference = documents.findLast((document) => document.startedAt <= actionAt)
    const required: readonly Signal[] =
      outcome === "accepted" && reference !== undefined
        ? SIGNALS.filter(
            (signal) => settledState(signalEvents(input, reference.id, signal)) === "granted",
          )
        : []

    const failures: string[] = []
    const evidence: EvidenceRef[] = []
    const unresolved: string[] = []
    for (const document of later) {
      const where = describe(document)
      if (document.banner === "shown") {
        failures.push(`the banner was shown again on ${where}`)
        evidence.push(documentRef(document.id))
      } else if (document.banner !== "hidden") {
        unresolved.push(`whether the banner was shown on ${where}`)
      }
      const reverted: Signal[] = []
      const unknown: Signal[] = []
      for (const signal of required) {
        const events = signalEvents(input, document.id, signal)
        const proof = revert(events)
        if (proof !== undefined) {
          reverted.push(signal)
          evidence.push(...proof, documentRef(document.id))
        } else if (settledState(events) !== "granted") unknown.push(signal)
      }
      if (reverted.length > 0)
        failures.push(`${reverted.join(", ")} went back to denied on ${where}`)
      if (unknown.length > 0) unresolved.push(`${unknown.join(", ")} on ${where}`)
    }

    const cited = nonEmpty([...new Map(evidence.map((ref) => [JSON.stringify(ref), ref])).values()])
    if (cited !== null && failures.length > 0)
      return fail(
        id,
        `${distinct(failures).join("; ")} after the visitor ${outcome === "accepted" ? "accepted" : "rejected"}`,
        cited,
      )
    // A step that failed or a deadline that cut the journey short leaves pages unvisited (a
    // reload refused because the page came from a POST, or dropped by the deadline).
    const cut = input.capture.errors.find((error) => CUT_SHORT.has(error.code))
    if (cut !== undefined)
      unresolved.push(`the pages the run did not reach (${cut.code}: ${cut.message})`)
    if (unresolved.length > 0)
      return inconclusive(
        id,
        `could not tell ${distinct(unresolved).join("; ")}`,
        later.map((document) => documentRef(document.id)),
      )
    const signals = required.length === 0 ? "" : ` and ${required.join(", ")} stayed granted`
    return pass(
      id,
      `the banner stayed hidden on ${count(later.length, "later page")}${signals}`,
      later.map((document) => documentRef(document.id)),
    )
  },
}
