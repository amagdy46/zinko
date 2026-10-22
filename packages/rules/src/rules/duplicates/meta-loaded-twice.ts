import { count, groupBy, hitRef, requestRef } from "../../documents.js"
import { fail, nonEmpty, notApplicable, pass } from "../../results.js"
import type { EvidenceRef, Rule } from "../../types.js"

const id = "duplicates.meta-loaded-twice"

const SIGNALS_CONFIG = /^https:\/\/connect\.facebook\.net\/signals\/config\/(\d+)(?=[/?#]|$)/

export const metaLoadedTwice: Rule = {
  id,
  area: "duplicates",
  severity: "warning",
  title: "Meta pixel loaded twice",
  why: "When the Meta pixel is installed twice (a shop plugin and a tag manager, or a theme snippet left behind), it is started twice for the same pixel and every event can go out twice: page views and conversions are overcounted, and the second copy may send them without the event ids the first one sets.",
  fix: [
    "Find every place that installs the pixel (the theme, shop or CMS plugins such as the Facebook for WooCommerce or Shopify app, the tag manager) and keep one.",
    "If two installs must stay, call fbq('init', …) for the pixel once and guard the second snippet so it does not reload fbevents.js.",
  ],
  evaluate(input) {
    const configs = input.capture.requests.flatMap((request) => {
      const pixel = SIGNALS_CONFIG.exec(request.url)?.[1]
      return pixel === undefined ? [] : [{ request, pixel }]
    })
    const pageViews = input.hits.filter((hit) => hit.vendor === "meta" && hit.event === "PageView")
    if (configs.length === 0 && !input.hits.some((hit) => hit.vendor === "meta"))
      return notApplicable(id, "the Meta pixel was not loaded")
    // fbevents.js fetches each pixel's config once per init, but a second fetch can be served from
    // the browser cache and never show up, so two PageViews for one pixel are enough on their own.
    // A single-page app sends a PageView per route change, so only PageViews for the same page
    // location count.
    const twiceConfigured = [
      ...groupBy(configs, ({ request, pixel }) => `${request.documentId} ${pixel}`).values(),
    ].filter((group) => group.length > 1)
    const twiceViewed = [
      ...groupBy(
        pageViews,
        (hit) => `${hit.documentId} ${hit.destinationId} ${String(hit.params.page_location ?? "")}`,
      ).values(),
    ].filter((group) => group.length > 1)
    const evidence = nonEmpty<EvidenceRef>([
      ...twiceConfigured.flat().map(({ request }) => requestRef(request.id)),
      ...twiceViewed.flat().map(hitRef),
    ])
    if (evidence === null) return pass(id, "each Meta pixel was started once per document")
    const parts = [
      twiceConfigured.length > 0
        ? `its config was fetched ${twiceConfigured.map((group) => group.length).join(", ")} times for pixel ${twiceConfigured.map((group) => group[0].pixel).join(", ")}`
        : null,
      twiceViewed.length > 0
        ? `${count(twiceViewed.flat().length, "PageView")} for pixel ${[...new Set(twiceViewed.map((group) => group[0].destinationId))].join(", ")} on the same page`
        : null,
    ].filter((part) => part !== null)
    return fail(id, `the Meta pixel was started twice: ${parts.join("; ")}`, evidence)
  },
}
