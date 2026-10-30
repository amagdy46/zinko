import type { ConsentState, Hit, Vendor } from "@zinko/decoders"
import type { CapturedRequest } from "@repo/capture-contract"
import type { RunInput } from "./types.js"

/**
 * How a run's consent is read. Under accept and reject the action splits the run in two; when the
 * banner was not found there is no action to split at, and when the action was not seen to take
 * effect (`not-applied`: the banner stayed or could not be checked, and no matching consent update
 * followed) the visitor's choice is unknown, so in both cases consent rules cannot judge the run. `none` and `gpc` never act:
 * everything they send is without consent.
 */
export type ConsentTimeline =
  | { kind: "action"; outcome: "accepted" | "rejected"; actionAt: number }
  | { kind: "no-action" }
  | { kind: "inconclusive"; reason: string }

export function consentTimeline(input: RunInput): ConsentTimeline {
  if (input.scenario === "none" || input.scenario === "gpc") return { kind: "no-action" }
  const { outcome, actionAt } = input.capture.consent
  if ((outcome === "accepted" || outcome === "rejected") && actionAt !== null)
    return { kind: "action", outcome, actionAt }
  if (outcome === "not-found") return { kind: "inconclusive", reason: "the banner was not found" }
  if (outcome === "not-applied")
    return { kind: "inconclusive", reason: "the consent choice was not seen to take effect" }
  return { kind: "inconclusive", reason: `the ${input.scenario} action did not run` }
}

/** Sent before the consent action, or at any time when there was none (`startedAt >= actionAt` is after). */
export function withoutConsent(input: RunInput, startedAt: number): boolean {
  const { outcome, actionAt } = input.capture.consent
  if ((outcome === "accepted" || outcome === "rejected") && actionAt !== null)
    return startedAt < actionAt
  return true
}

/** Meta and TikTok: vendors with no consent flag on the hit, judged by whether the hit fired. */
export function isNonGoogle(vendor: Vendor): boolean {
  return vendor === "meta" || vendor === "tiktok"
}

export function isGoogle(vendor: Vendor): boolean {
  return vendor === "ga4" || vendor === "google-ads"
}

const GOOGLE_HOST =
  /(^|\.)(google\.[a-z]{2,3}(\.[a-z]{2})?|googlesyndication\.com|doubleclick\.net)$/

/**
 * Consent Mode pings (`/ccm/collect` on Google's hosts), which the decoders leave out because they
 * mirror events already decoded. `ad.doubleclick.net/ccm/s/collect` is not one: it carries no
 * consent state at all.
 */
export function isCcmRequest(request: Pick<CapturedRequest, "url">): boolean {
  if (!URL.canParse(request.url)) return false
  const url = new URL(request.url)
  return GOOGLE_HOST.test(url.hostname) && url.pathname === "/ccm/collect"
}

function flag(c: string | undefined): ConsentState {
  if (c === "1") return "granted"
  return c === "0" ? "denied" : "unknown"
}

/**
 * The consent state a `ccm` request carries in `gcs` ("G1" + ad_storage + analytics_storage, each
 * "1" granted or "0" denied), or `null` for a request that is not a `ccm` ping.
 */
export function googleConsentFromCcm(request: Pick<CapturedRequest, "url">): Hit["consent"] | null {
  if (!isCcmRequest(request)) return null
  const gcs = new URL(request.url).searchParams.get("gcs") ?? undefined
  if (gcs === undefined || !/^G1[01]{2}$/.test(gcs))
    return { adStorage: "unknown", analyticsStorage: "unknown", raw: gcs }
  return { adStorage: flag(gcs[2]), analyticsStorage: flag(gcs[3]), raw: gcs }
}

/** Both storages denied, which is what a Google tag must say before consent (`gcs=G100`). */
export function isDenied(consent: Hit["consent"]): boolean {
  return consent.adStorage === "denied" && consent.analyticsStorage === "denied"
}
