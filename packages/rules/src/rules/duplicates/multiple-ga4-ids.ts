import { count, distinct, documentRef, groupBy, hitRef } from "../../documents.js"
import { fail, nonEmpty, notApplicable, pass } from "../../results.js"
import type { EvidenceRef, Rule } from "../../types.js"

const id = "duplicates.multiple-ga4-ids"

export const multipleGa4Ids: Rule = {
  id,
  area: "duplicates",
  severity: "warning",
  title: "One page sends to more than one GA4 measurement ID",
  why: "Each GA4 measurement ID is a separate data stream. A page that sends to two usually has an old property left in place or a second Google tag added by a plugin, so every page view and purchase is counted in both properties, and whichever one the reports read may be the wrong one.",
  fix: [
    "List every GA4 measurement ID the page sends to (G-…), and remove the ones that are not the site's current property: an old gtag snippet, a CMS or shop plugin, a second Google tag in the tag manager.",
    "If a second property is intended (a roll-up or an agency property), document it so the double counting is known, and send to it from one Google tag with groups rather than two installs.",
  ],
  evaluate(input) {
    const byDocument = [
      ...groupBy(
        input.hits.filter((hit) => hit.vendor === "ga4"),
        (hit) => hit.documentId,
      ).values(),
    ]
    if (byDocument.length === 0) return notApplicable(id, "no GA4 hit was sent")
    const multiple = byDocument.filter(
      (hits) => distinct(hits.map((hit) => hit.destinationId)).length > 1,
    )
    // One hit per measurement ID is enough to show it.
    const evidence = nonEmpty<EvidenceRef>(
      multiple.flatMap((hits) => [
        documentRef(hits[0].documentId),
        ...[...groupBy(hits, (hit) => hit.destinationId).values()].map(([first]) => hitRef(first)),
      ]),
    )
    if (evidence === null)
      return pass(id, `${count(byDocument.length, "document")} sent to one GA4 measurement ID`)
    const ids = distinct(multiple.flatMap((hits) => hits.map((hit) => hit.destinationId)))
    return fail(
      id,
      `${count(multiple.length, "document")} sent GA4 hits to ${ids.length} measurement IDs (${ids.join(", ")})`,
      evidence,
    )
  },
}
