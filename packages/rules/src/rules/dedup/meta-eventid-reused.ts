import { count, distinct, groupBy, hitRef } from "../../documents.js"
import { fail, nonEmpty, notApplicable, pass } from "../../results.js"
import type { Rule } from "../../types.js"

const id = "dedup.meta-eventid-reused"

export const metaEventIdReused: Rule = {
  id,
  area: "dedup",
  severity: "warning",
  title: "Meta event ID reused across events",
  why: "Meta treats events with the same event ID as copies of one event and keeps only one. When a fixed or shared ID is sent with different events, Meta drops all but one of them, so page views, add-to-carts or purchases silently disappear from reporting and optimization.",
  fix: [
    "Generate a new event ID for every event: the order ID for a purchase, a random or sequential ID for the others, never a constant.",
    "In the tag manager, check that the Event ID variable is not a fixed value or a variable that only changes on page load.",
  ],
  evaluate(input) {
    const meta = input.hits.filter((hit) => hit.vendor === "meta")
    if (meta.length === 0) return notApplicable(id, "no Meta hit was sent")
    const withId = meta.filter((hit) => hit.ids.eventId)
    const reused = [
      ...groupBy(withId, (hit) => `${hit.destinationId} ${hit.ids.eventId}`).values(),
    ].filter((group) => group.length > 1)
    const evidence = nonEmpty(reused.flat().map(hitRef))
    if (evidence === null)
      return pass(id, `${count(withId.length, "Meta hit")} with an event ID, none repeated`)
    const what = reused
      .map(
        (group) =>
          `"${group[0].ids.eventId}" on ${count(group.length, "hit")} (${distinct(group.map((hit) => hit.event)).join(", ")})`,
      )
      .join("; ")
    return fail(id, `an event ID was sent more than once: ${what}`, evidence)
  },
}
