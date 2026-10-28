import type { Collector } from "./types.js"

/**
 * Hosts Google runs for measurement: GA4 (`google-analytics.com`, `analytics.google.com` and their
 * regional `region1.` forms), Tag Manager, and the Ads endpoints.
 */
const GOOGLE_HOSTS =
  /(^|\.)(google-analytics\.com|analytics\.google\.com|googletagmanager\.com|google\.[a-z]{2,3}(\.[a-z]{2})?|googleadservices\.com|googlesyndication\.com|doubleclick\.net)$/

/** A request that already has a Google tag's shape is `first-party` when it went anywhere but Google's hosts. */
export function collectorOf(url: URL): Collector {
  return GOOGLE_HOSTS.test(url.hostname) ? "google" : "first-party"
}
