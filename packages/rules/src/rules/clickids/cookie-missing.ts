import { consentTimeline } from "../../consent-state.js"
import { snapshotsLabelled } from "../../cookies.js"
import { documentRef, hitRef, vendorName } from "../../documents.js"
import { CLICK_IDS, landingDocument, queryParam } from "../../landing.js"
import { fail, inconclusive, notApplicable, pass } from "../../results.js"
import type { EvidenceRef, Rule } from "../../types.js"

const id = "clickid.cookie-missing"

export const cookieMissing: Rule = {
  id,
  area: "clickids",
  severity: "warning",
  title: "Missing conversion linker",
  why: "The click ID on the landing URL only reaches a later conversion if a cookie keeps it: _gcl_aw for Google Ads (written by the conversion linker), _fbc for Meta, _ttp for TikTok. Without the cookie, a purchase on another page cannot be tied to the ad click, and the platforms under-report conversions and bid on the wrong campaigns.",
  fix: [
    "Google Ads: add a Conversion Linker tag in Google Tag Manager that fires on all pages, or leave conversion_linker on in the gtag config (it is on by default).",
    "Meta: let the pixel write _fbc (first-party cookies on in the pixel settings), or write it yourself from fbclid as fb.1.<timestamp>.<fbclid>.",
    "TikTok: keep the pixel's first-party cookies on, so _ttp is written on the landing page.",
    "Check that the consent banner grants the cookies once the visitor accepts, and that nothing deletes them afterwards.",
  ],
  evaluate(input) {
    if (input.scenario !== "accept")
      return notApplicable(id, "only checked when the visitor accepts")
    const landing = landingDocument(input)
    if (landing === undefined) return inconclusive(id, "the run has no landing document")
    // The landing document's URL, after redirects: a click ID a redirect dropped is
    // clickid.lost-on-redirect's finding, and no cookie could be expected from it here.
    const expected = CLICK_IDS.flatMap((clickId) => {
      if (queryParam(landing.url, clickId.param) === null) return []
      const hits = input.hits.filter((hit) => hit.vendor === clickId.vendor)
      return hits.length === 0 ? [] : [{ ...clickId, hits }]
    })
    if (expected.length === 0)
      return notApplicable(id, "the landing URL has no click ID of a vendor whose tags fired")
    const end = snapshotsLabelled(input, "end")
    if (end.length === 0) return inconclusive(id, "the run has no end cookie snapshot")
    const names = new Set(end.flatMap((snapshot) => snapshot.cookies.map((cookie) => cookie.name)))
    const missing = expected.filter((clickId) => !names.has(clickId.cookie))
    const checked = expected.map(({ param, cookie }) => `${param} → ${cookie}`).join(", ")
    if (missing.length === 0) return pass(id, `every click ID was kept in its cookie (${checked})`)
    const what = missing
      .map(({ param, cookie, vendor }) => `${cookie} (${vendorName(vendor)}, from ${param})`)
      .join(", ")
    // Without a found banner nothing shows the visitor consented, so a missing cookie may just be
    // the site waiting for consent.
    if (consentTimeline(input).kind !== "action")
      return inconclusive(id, `${what} missing at the end, but the banner was not found`)
    const evidence: [EvidenceRef, ...EvidenceRef[]] = [
      documentRef(landing.id),
      ...missing.flatMap(({ hits }) => hits.slice(0, 1).map(hitRef)),
    ]
    return fail(id, `${what} missing at the end of the run`, evidence)
  },
}
