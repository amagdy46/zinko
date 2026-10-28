import { count, groupBy, hitRef } from "../../documents.js"
import { eventLabel } from "../../event-names.js"
import { fail, nonEmpty, notApplicable, pass } from "../../results.js"
import { withoutRetransmissions } from "../../retransmissions.js"
import type { Rule } from "../../types.js"

const id = "dedup.meta-eventid-reused"

export const metaEventIdReused: Rule = {
  id,
  area: "dedup",
  severity: "warning",
  owner: "developer",
  title: "Meta event ID reused for the same event",
  checkTitle: "Meta event IDs unique per event",
  why: "Meta deduplicates by pixel, event name and event ID: a second event with the same name and ID is taken for a copy of the first and dropped. When a fixed or shared ID is sent with two real events of one kind (two add-to-carts, two leads), every one after the first silently disappears from reporting and optimization.",
  fix: [
    "Generate a new event ID for every event: the order ID for a purchase, a random or sequential ID for the others, never a constant.",
    "In the tag manager, check that the Event ID variable is not a fixed value or a variable that only changes on page load.",
  ],
  evaluate(input) {
    const meta = input.hits.filter((hit) => hit.vendor === "meta")
    if (meta.length === 0) return notApplicable(id, "no Meta hit was sent")
    const withId = withoutRetransmissions(
      input,
      meta.filter((hit) => hit.ids.eventId),
    )
    const reused = [
      ...groupBy(withId, (hit) => `${hit.destinationId} ${hit.event} ${hit.ids.eventId}`).values(),
    ].filter((group) => group.length > 1)
    const evidence = nonEmpty(reused.flat().map(hitRef))
    if (evidence === null)
      return pass(
        id,
        `${count(withId.length, "Meta hit")} with an event ID, none repeated for the same event`,
      )
    const what = reused.map((group) => `${eventLabel(group[0])} ${group.length} times`).join("; ")
    return fail(
      id,
      `the same event and event ID were sent more than once, so Meta keeps only the first: ${what}`,
      evidence,
    )
  },
}
