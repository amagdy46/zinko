import { count, distinct, groupBy, hitRef } from "../../documents.js"
import { fail, nonEmpty, notApplicable, pass } from "../../results.js"
import { transactionId } from "../../purchases.js"
import type { DecodedHit, EvidenceRef, Rule } from "../../types.js"

const id = "duplicates.client-and-server-ga4"

/** Two sends of an event without a transaction ID are one event when they start this close together. */
const PAIR_WINDOW_MS = 5000

/** A GA4 event is identified by its document, measurement ID and name, plus the order it reports. */
function eventKey(hit: DecodedHit): string {
  return [hit.documentId, hit.destinationId, hit.event, transactionId(hit) ?? ""].join(" ")
}

/** The page a hit reports, by host name and path: gtag drops the port from `page_location`, other senders keep it. */
function page(hit: DecodedHit): string {
  const location = hit.params.page_location
  if (typeof location !== "string" || !URL.canParse(location)) return String(location)
  const url = new URL(location)
  return `${url.hostname}${url.pathname}`
}

/**
 * Pairs each first-party hit with at most one direct hit, in start order. With a transaction ID the
 * two are the same order whenever they were sent; without one they need the same `page_location`
 * and a start less than `PAIR_WINDOW_MS` apart.
 */
function pairs(
  direct: readonly DecodedHit[],
  firstParty: readonly DecodedHit[],
): [DecodedHit, DecodedHit][] {
  const free = [...direct]
  const found: [DecodedHit, DecodedHit][] = []
  for (const hit of firstParty) {
    const match = free.findIndex(
      (candidate) =>
        transactionId(hit) !== undefined ||
        (page(candidate) === page(hit) &&
          Math.abs(candidate.startedAt - hit.startedAt) < PAIR_WINDOW_MS),
    )
    if (match === -1) continue
    found.push([free.splice(match, 1)[0]!, hit])
  }
  return found
}

export const clientAndServerGa4: Rule = {
  id,
  area: "duplicates",
  severity: "warning",
  owner: "tag-manager",
  title: "The same GA4 event is sent to Google and to a first-party collector",
  checkTitle: "Each GA4 event goes to one collector",
  why: "When a page sends an event to Google and the same event to a server-side or gateway endpoint on the site's own domain, GA4 receives it twice. Page views, events and sessions are inflated, and a purchase is only saved when GA4 drops the repeat of its transaction ID, which it does not for other events. It usually comes from a Google tag left in place when a server-side container was added, or from a plugin that sends on its own.",
  fix: [
    "Decide which path owns the event: either the browser sends to Google, or it sends only to the server-side container and that forwards to Google.",
    "Remove the second sender: the GA4 tag that still points at Google, or the plugin or second container that posts to the server endpoint. In a server-side setup the Google tag's transport_url or server_container_url should be the only GA4 destination.",
    "If the two are intentional (for example a second property), send them to different measurement IDs so they are not counted twice in one.",
  ],
  evaluate(input) {
    const ga4 = input.hits.filter((hit) => hit.vendor === "ga4")
    if (ga4.length === 0) return notApplicable(id, "no GA4 hit was sent")
    const firstParty = ga4.filter((hit) => hit.collector === "first-party")
    if (firstParty.length === 0)
      return notApplicable(id, "no GA4 hit went to a first-party collector")
    const direct = ga4.filter((hit) => hit.collector === "google")
    if (direct.length === 0)
      return pass(
        id,
        `all ${count(firstParty.length, "GA4 hit")} went to the first-party collector, none to Google`,
      )

    const groups = groupBy(ga4, eventKey)
    const found = [...groups.values()].flatMap((hits) =>
      pairs(
        hits.filter((hit) => hit.collector === "google"),
        hits.filter((hit) => hit.collector === "first-party"),
      ),
    )
    const evidence = nonEmpty<EvidenceRef>(found.flatMap(([a, b]) => [hitRef(a), hitRef(b)]))
    if (evidence === null)
      return pass(
        id,
        `${count(direct.length, "GA4 hit")} went to Google and ${firstParty.length} to the first-party collector, none of them the same event`,
      )
    const events = distinct(found.map(([hit]) => hit.event)).join(", ")
    return fail(
      id,
      `${count(found.length, "GA4 event")} sent both to Google and to a first-party collector (${events})`,
      evidence,
    )
  },
}
