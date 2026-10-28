import { count, distinct, documentRef, groupBy, hitRef } from "../../documents.js"
import { destinationLabel, eventLabel } from "../../event-names.js"
import { fail, nonEmpty, notApplicable, pass } from "../../results.js"
import type { EvidenceRef, Rule } from "../../types.js"

const id = "coverage.no-page-view"

export const noPageView: Rule = {
  id,
  area: "coverage",
  severity: "warning",
  owner: "tag-manager",
  title: "GA4 events without a page_view",
  checkTitle: "GA4 events preceded by a page_view",
  why: "GA4 builds sessions, landing pages and traffic sources from page_view. When a page sends other GA4 events but no page_view, its visits are missing from page reports and its events are attributed to the wrong page or to no session source.",
  fix: [
    "Remove send_page_view: false from the GA4 config, or send the page_view yourself (a GA4 event tag on page load, or gtag('event', 'page_view') on each route change in a single-page app).",
    "With Google Tag Manager, check that the Google tag for this measurement ID fires on every page, not only on the events that use it.",
  ],
  evaluate(input) {
    if (input.scenario !== "accept")
      return notApplicable(id, "only checked when the visitor accepts")
    // Each GA4 property needs its own page_view, so a stream is one document and measurement ID.
    const streams = [
      ...groupBy(
        input.hits.filter((hit) => hit.vendor === "ga4"),
        (hit) => `${hit.documentId} ${hit.destinationId}`,
      ).values(),
    ]
    if (streams.length === 0) return notApplicable(id, "no GA4 hit was sent")
    const without = streams.filter((events) => !events.some((hit) => hit.event === "page_view"))
    const documents = distinct(without.flatMap((events) => events.map((hit) => hit.documentId)))
    const evidence = nonEmpty<EvidenceRef>([
      ...documents.map(documentRef),
      ...without.flatMap((events) => events.map(hitRef)),
    ])
    if (evidence === null) return pass(id, "every document with GA4 hits sent a page_view")
    const hits = without.flat()
    const events = distinct(hits.map((hit) => eventLabel(hit))).join(", ")
    const ids = distinct(hits.map((hit) => destinationLabel(hit.destinationId))).join(", ")
    return fail(
      id,
      `${count(documents.length, "document")} sent GA4 events (${events}) to ${ids} without a page_view`,
      evidence,
    )
  },
}
