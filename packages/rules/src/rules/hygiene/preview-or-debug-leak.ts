import { count, hitRef, requestRef } from "../../documents.js"
import { fail, nonEmpty, notApplicable, pass } from "../../results.js"
import type { EvidenceRef, Rule } from "../../types.js"

const id = "debug.preview-or-debug-leak"

/**
 * Query parameters GTM adds to the container script (`/gtm.js`) when it loads a preview or debug
 * environment: `gtm_auth` and `gtm_preview` come from the environment snippet Tag Manager gives for
 * a workspace or environment; `gtm_debug` is the Tag Assistant's debug session.
 */
const GTM_MARKERS = ["gtm_preview", "gtm_auth", "gtm_debug"]

export const previewOrDebugLeak: Rule = {
  id,
  area: "hygiene",
  severity: "warning",
  owner: "tag-manager",
  title: "Tag Manager preview or GA4 debug mode left on",
  checkTitle: "No preview or debug mode in production",
  why: "A Tag Manager container loaded from a preview environment runs unpublished changes for every visitor, and GA4 hits in debug mode go to DebugView instead of the reports. Both usually mean a test snippet or setting was left in place, and the data collected under it is missing or wrong.",
  fix: [
    "Replace the Tag Manager snippet with the live one (Admin → Install Google Tag Manager): it has no gtm_auth, gtm_preview or gtm_cookies_win parameters.",
    "Remove debug_mode from the Google tag's or GA4 configuration tag's fields to set, and from any gtag('config') call; turn off the debugging extension used while testing.",
  ],
  evaluate(input) {
    const containers = input.capture.requests.filter(
      (request) => URL.canParse(request.url) && new URL(request.url).pathname.endsWith("/gtm.js"),
    )
    const ga4 = input.hits.filter((hit) => hit.vendor === "ga4")
    if (containers.length === 0 && ga4.length === 0)
      return notApplicable(id, "no Tag Manager container or GA4 hit was sent")

    const previews = containers.filter((request) => {
      const { searchParams } = new URL(request.url)
      return GTM_MARKERS.some((name) => searchParams.has(name))
    })
    const debugHits = ga4.filter(
      (hit) =>
        hit.params.debug_view === "1" ||
        hit.params.debug_mode === "1" ||
        hit.params.debug_mode === "true",
    )
    const evidence = nonEmpty<EvidenceRef>([
      ...previews.map((request) => requestRef(request.id)),
      ...debugHits.map(hitRef),
    ])
    if (evidence === null)
      return pass(id, "no Tag Manager preview parameter and no GA4 debug flag was sent")

    const what = [
      previews.length > 0
        ? `${count(previews.length, "Tag Manager container request")} in preview mode`
        : null,
      debugHits.length > 0 ? `${count(debugHits.length, "GA4 hit")} in debug mode` : null,
    ]
      .filter((part) => part !== null)
      .join(" and ")
    return fail(id, what, evidence)
  },
}
