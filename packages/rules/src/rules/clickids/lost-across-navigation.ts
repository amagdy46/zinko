import type { CapturedDocument, Cookie, CookieSnapshot } from "@repo/capture-contract"
import { consentTimeline } from "../../consent-state.js"
import { count, documentRef, hitRef } from "../../documents.js"
import { fail, inconclusive, nonEmpty, notApplicable, pass } from "../../results.js"
import type { DecodedHit, EvidenceRef, Rule, RunInput } from "../../types.js"

const id = "clickid.lost-across-navigation"

/**
 * Per vendor: the landing URL's click ID, the hits that should carry it on later pages, the id the
 * decoder files it under, and the first-party cookie that carries it between pages. TikTok is left
 * out: its click ID only shows in the `ttp` and callback payloads, which are not decoded.
 */
const VENDORS = [
  {
    param: "gclid",
    what: "Google Ads conversion",
    shouldCarry: (hit: DecodedHit) => hit.vendor === "google-ads" && hit.event === "conversion",
    idKey: "gclid",
    cookie: "_gcl_aw",
  },
  {
    param: "fbclid",
    what: "Meta Purchase",
    shouldCarry: (hit: DecodedHit) => hit.vendor === "meta" && hit.event === "Purchase",
    idKey: "fbc",
    cookie: "_fbc",
  },
] as const

type Vendor = (typeof VENDORS)[number]

function landingClickIds(pageUrl: string): readonly Vendor[] {
  if (!URL.canParse(pageUrl)) return []
  const params = new URL(pageUrl).searchParams
  return VENDORS.filter((vendor) => (params.get(vendor.param) ?? "") !== "")
}

/** The cookies as the document left them: `document-end` before a navigation, `end` for the last. */
function snapshotLeaving(
  input: RunInput,
  document: CapturedDocument,
  last: boolean,
): CookieSnapshot | undefined {
  return input.capture.cookies.find((snapshot) =>
    last
      ? snapshot.label === "end"
      : snapshot.label === "document-end" && snapshot.documentId === document.id,
  )
}

/** The browser sends the cookie to the document's host: its own domain or a parent one. */
function readableOn(cookie: Cookie, url: string): boolean {
  if (!URL.canParse(url)) return false
  const host = new URL(url).hostname
  const domain = cookie.domain.replace(/^\./, "")
  return host === domain || host.endsWith(`.${domain}`)
}

function pathOf(url: string): string {
  if (!URL.canParse(url)) return url
  const { pathname, search } = new URL(url)
  return pathname + search
}

export const lostAcrossNavigation: Rule = {
  id,
  area: "clickids",
  severity: "warning",
  title: "Click ID lost between pages",
  why: "A visitor who lands from an ad brings a click ID on the landing URL. When a conversion on a later page carries neither that click ID nor the cookie that stores it, the ad platform cannot tie the sale to the click: the campaign looks like it converts less than it does, and bidding optimizes on the wrong signal.",
  fix: [
    "For Google Ads, turn the Conversion Linker on (in Google Tag Manager, a Conversion Linker tag on all pages; with gtag, do not set conversion_linker: false) so _gcl_aw stores the gclid on the landing page.",
    "For Meta, let the pixel store fbclid in the _fbc cookie on the landing page (first-party cookies on), or pass fbc with the event.",
    "When later pages are on another domain (a checkout or payment host), set up cross-domain linking so the click ID travels with the link.",
  ],
  evaluate(input) {
    if (!input.journey) return notApplicable(id, "only checked on journey runs")
    if (input.scenario !== "accept")
      return notApplicable(id, "only checked when the visitor accepts")
    const vendors = landingClickIds(input.pageUrl)
    if (vendors.length === 0) return notApplicable(id, "the landing URL carries no gclid or fbclid")
    const timeline = consentTimeline(input)
    if (timeline.kind === "inconclusive") return inconclusive(id, timeline.reason)
    if (timeline.kind === "no-action") return inconclusive(id, "the accept action did not run")
    const later = input.capture.documents.slice(1)
    if (later.length === 0) return inconclusive(id, "the journey reached no later page")

    let checked = 0
    const lost: { message: string; evidence: EvidenceRef[] }[] = []
    const unseen: string[] = []
    later.forEach((document, index) => {
      const last = index === later.length - 1
      for (const vendor of vendors) {
        const hits = input.hits.filter(
          (hit) => hit.documentId === document.id && vendor.shouldCarry(hit),
        )
        checked += hits.length
        const without = hits.filter((hit) => (hit.ids[vendor.idKey] ?? "") === "")
        if (without.length === 0) continue
        const snapshot = snapshotLeaving(input, document, last)
        if (snapshot === undefined) {
          unseen.push(pathOf(document.url))
          continue
        }
        const carried = snapshot.cookies.some(
          (cookie) => cookie.name === vendor.cookie && readableOn(cookie, document.url),
        )
        if (carried) continue
        lost.push({
          message: `${count(without.length, vendor.what)} on ${pathOf(document.url)} without ${vendor.idKey} and no ${vendor.cookie} cookie`,
          evidence: [...without.map(hitRef), documentRef(document.id)],
        })
      }
    })

    const evidence = nonEmpty(lost.flatMap((l) => l.evidence))
    if (evidence !== null) return fail(id, lost.map((l) => l.message).join("; "), evidence)
    if (unseen.length > 0)
      return inconclusive(id, `no cookie snapshot when leaving ${unseen.join(", ")}`)
    const params = vendors.map((vendor) => vendor.param).join(" and ")
    if (checked === 0)
      return notApplicable(id, `no later page sent a hit that should carry ${params}`)
    return pass(id, `${count(checked, "later hit")} carried the ${params} or its cookie`)
  },
}
