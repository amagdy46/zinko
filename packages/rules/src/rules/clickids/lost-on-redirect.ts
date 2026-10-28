import { documentRef } from "../../documents.js"
import { CLICK_IDS, landingDocument, queryParam } from "../../landing.js"
import { fail, inconclusive, notApplicable, pass } from "../../results.js"
import type { Rule } from "../../types.js"

const id = "clickid.lost-on-redirect"

export const lostOnRedirect: Rule = {
  id,
  area: "clickids",
  severity: "warning",
  owner: "developer",
  title: "Redirects dropping click IDs",
  checkTitle: "Click IDs survive redirects",
  why: "Ad platforms attribute a conversion to the click through the click ID on the landing URL (gclid, fbclid, ttclid). A redirect that drops the query string (a tracking link, an http to https or trailing-slash rule, a locale redirect) lands the visitor without it, so the tags never see the click and the conversion is reported as unattributed.",
  fix: [
    "Make every redirect on the landing path keep the query string: in the server or CDN rule, append the original query (for example $args in nginx, the QSA flag in Apache, 'preserve query string' in a CDN redirect rule).",
    "Point ads at the final URL, so the click does not go through a redirect at all.",
  ],
  evaluate(input) {
    // The URL the run asked for, before any redirect: that is where the ad click landed.
    const sent = CLICK_IDS.flatMap((clickId) => {
      const value = queryParam(input.pageUrl, clickId.param)
      return value === null ? [] : [{ param: clickId.param, value }]
    })
    if (sent.length === 0) return notApplicable(id, "the run URL has no click ID")
    const landing = landingDocument(input)
    if (landing === undefined) return inconclusive(id, "the run has no landing document")
    const names = sent.map(({ param }) => param).join(", ")
    if (landing.redirects.length === 0)
      return pass(id, `the landing URL was not redirected, so ${names} arrived`)
    const lost = sent.filter(({ param, value }) => queryParam(landing.url, param) !== value)
    const hops = landing.redirects.length
    if (lost.length === 0)
      return pass(id, `${names} survived ${hops === 1 ? "the redirect" : `${hops} redirects`}`)
    return fail(
      id,
      `${lost.map(({ param }) => param).join(", ")} lost after ${hops === 1 ? "1 redirect" : `${hops} redirects`}: the page landed on ${landing.url}`,
      [documentRef(landing.id)],
    )
  },
}
