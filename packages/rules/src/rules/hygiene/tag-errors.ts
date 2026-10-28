import { isCollectionRequest } from "@ovriq/zinko-decoders"
import { count, distinct, requestRef } from "../../documents.js"
import { fail, inconclusive, nonEmpty, notApplicable, pass } from "../../results.js"
import type { Rule } from "../../types.js"

const id = "hygiene.tag-errors"

export const tagErrors: Rule = {
  id,
  area: "hygiene",
  severity: "warning",
  owner: "tag-manager",
  title: "Tracking requests failing with HTTP errors",
  checkTitle: "Tracking requests succeed",
  why: "A hit answered with a 4xx or 5xx was not recorded. A server-side tag manager that is down or misconfigured, a wrong endpoint or a revoked pixel loses every event it should collect, and nothing on the page shows it.",
  fix: [
    "Open the failing endpoint: for a server-side Google Tag Manager container, check that the server is running, its domain points at it, and its clients accept the request path (/g/collect for GA4).",
    "Check the measurement or pixel ID in the failing requests, and that the transport_url or server_container_url in the tag settings is the container's address.",
  ],
  evaluate(input) {
    // Every request a decoder read as a hit, wherever it was sent (a first-party /g/collect is a
    // server-side container), and the known collection endpoints the decoders skip.
    const hitRequests = new Set(input.hits.map((hit) => hit.requestId))
    const tracking = input.capture.requests.filter(
      (request) =>
        request.method.toUpperCase() !== "OPTIONS" &&
        (hitRequests.has(request.id) || isCollectionRequest(request.method, request.url)),
    )
    if (tracking.length === 0) return notApplicable(id, "no tracking request was sent")
    const answered = tracking.filter((request) => !request.blocked && request.status !== null)
    if (answered.length === 0) {
      const local = tracking.every((request) => request.blocked)
      return inconclusive(
        id,
        local
          ? "Endpoint delivery was not checked because Zinko answered tracking requests locally"
          : "no tracking request got a response",
      )
    }
    const failed = answered.filter((request) => (request.status ?? 0) >= 400)
    const evidence = nonEmpty(failed.map((request) => requestRef(request.id)))
    const local = tracking.length - answered.length
    const note =
      local > 0 ? `; ${count(local, "other")} answered locally or without a response` : ""
    if (evidence === null)
      return pass(
        id,
        `${count(answered.length, "tracking request")} reached its endpoint without an error${note}`,
      )
    const where = distinct(
      failed.map((request) => {
        const host = URL.canParse(request.url) ? new URL(request.url).host : "an unreadable URL"
        return `${request.method} ${host} → ${request.status}`
      }),
    ).join(", ")
    return fail(
      id,
      `${count(failed.length, "tracking request")} got an HTTP error: ${where}`,
      evidence,
    )
  },
}
