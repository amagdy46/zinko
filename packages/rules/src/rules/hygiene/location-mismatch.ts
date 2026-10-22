import { count, distinct, documentRef, hitRef, vendorName } from "../../documents.js"
import { fail, nonEmpty, notApplicable, pass } from "../../results.js"
import type { EvidenceRef, Rule } from "../../types.js"

const id = "hygiene.location-mismatch"

function hostname(url: string): string | null {
  return URL.canParse(url) ? new URL(url).hostname : null
}

export const locationMismatch: Rule = {
  id,
  area: "hygiene",
  severity: "warning",
  title: "Hits report another site's page location",
  why: "GA4 and Meta read the page a hit came from from its page location. When a tag overrides it with another host (a staging or old domain, a hard-coded URL), page reports, referral exclusions and audiences built on URLs all describe the wrong site, and the real pages look as if they were never visited.",
  fix: [
    "Remove the page_location override from the GA4 config or tag, or build it from the current page (location.href) instead of a fixed host.",
    "If a staging or development build was copied to production, check its tag settings and environment variables for the old host.",
  ],
  evaluate(input) {
    const documents = new Map(input.capture.documents.map((doc) => [doc.id, doc]))
    // GA4 drops the port from page_location and Meta keeps it, so host names are compared, not hosts.
    const compared = input.hits.flatMap((hit) => {
      if (hit.vendor !== "ga4" && hit.vendor !== "meta") return []
      const location = hit.params.page_location
      const doc = documents.get(hit.documentId)
      if (location === undefined || doc === undefined) return []
      const reported = hostname(String(location))
      const actual = hostname(doc.url)
      return reported === null || actual === null ? [] : [{ hit, reported, actual }]
    })
    if (compared.length === 0)
      return notApplicable(id, "no GA4 or Meta hit reported a page location")
    const mismatched = compared.filter(({ reported, actual }) => reported !== actual)
    const evidence = nonEmpty<EvidenceRef>([
      ...distinct(mismatched.map(({ hit }) => hit.documentId)).map(documentRef),
      ...mismatched.map(({ hit }) => hitRef(hit)),
    ])
    if (evidence === null)
      return pass(
        id,
        `${count(compared.length, "hit")} reported the host of the page it was sent from`,
      )
    const what = distinct(
      mismatched.map(
        ({ hit, reported, actual }) =>
          `${vendorName(hit.vendor)} reported ${reported} on ${actual}`,
      ),
    ).join("; ")
    return fail(
      id,
      `${count(mismatched.length, "hit")} with another host's page location: ${what}`,
      evidence,
    )
  },
}
