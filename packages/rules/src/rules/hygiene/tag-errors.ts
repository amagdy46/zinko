import { count, distinct, requestRef } from "../../documents.js"
import { fail, inconclusive, nonEmpty, notApplicable, pass } from "../../results.js"
import type { Rule } from "../../types.js"

const id = "hygiene.tag-errors"

/**
 * Vendor collection endpoints the decoders leave undecoded (Consent Mode pings, audience syncs,
 * TikTok's page metadata). Listed by path, so other resources on vendor hosts, such as a favicon,
 * are not tracking requests.
 */
const COLLECTION_ENDPOINTS: readonly { host: RegExp; path: RegExp }[] = [
  {
    host: /(^|\.)(google\.com|googlesyndication\.com)$/,
    path: /^\/(ccm\/collect|pagead\/1p-user-list\/)/,
  },
  { host: /(^|\.)googleadservices\.com$/, path: /^\/pagead\/set_partitioned_cookie$/ },
  { host: /(^|\.)doubleclick\.net$/, path: /^\/ccm\/s\/collect$/ },
  { host: /^analytics\.tiktok\.com$/, path: /^\/api\/v2\/pixel\/act\/?$/ },
]

function isCollectionEndpoint(url: string): boolean {
  if (!URL.canParse(url)) return false
  const { hostname, pathname } = new URL(url)
  return COLLECTION_ENDPOINTS.some(({ host, path }) => host.test(hostname) && path.test(pathname))
}

export const tagErrors: Rule = {
  id,
  area: "hygiene",
  severity: "warning",
  title: "Tracking requests failing with HTTP errors",
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
        (hitRequests.has(request.id) || isCollectionEndpoint(request.url)),
    )
    if (tracking.length === 0) return notApplicable(id, "no tracking request was sent")
    const answered = tracking.filter((request) => !request.blocked && request.status !== null)
    if (answered.length === 0) {
      const local = tracking.every((request) => request.blocked)
      return inconclusive(
        id,
        local
          ? `every tracking request was answered locally (${count(tracking.length, "request")}), so no endpoint's answer was seen`
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
        const target = URL.canParse(request.url) ? new URL(request.url) : null
        const path = target === null ? request.url : `${target.host}${target.pathname}`
        return `${request.method} ${path} → ${request.status}`
      }),
    ).join(", ")
    return fail(
      id,
      `${count(failed.length, "tracking request")} got an HTTP error: ${where}`,
      evidence,
    )
  },
}
