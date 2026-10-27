import type { CaptureResult } from "@repo/capture-contract"
import { inconclusive } from "./results.js"
import { cookieMissing } from "./rules/clickids/cookie-missing.js"
import { lostAcrossNavigation } from "./rules/clickids/lost-across-navigation.js"
import { lostOnRedirect } from "./rules/clickids/lost-on-redirect.js"
import { cookiesWithoutConsent } from "./rules/consent/cookies-without-consent.js"
import { defaultAfterTag } from "./rules/consent/default-after-tag.js"
import { googleWithoutDeniedState } from "./rules/consent/google-without-denied-state.js"
import { pixelAfterReject } from "./rules/consent/pixel-after-reject.js"
import { pixelWithoutConsent } from "./rules/consent/pixel-without-consent.js"
import { invalidCurrency } from "./rules/coverage/invalid-currency.js"
import { noPageView } from "./rules/coverage/no-page-view.js"
import { purchaseMissingFields } from "./rules/coverage/purchase-missing-fields.js"
import { metaEventIdMissing } from "./rules/dedup/meta-eventid-missing.js"
import { metaEventIdReused } from "./rules/dedup/meta-eventid-reused.js"
import { metaLoadedTwice } from "./rules/duplicates/meta-loaded-twice.js"
import { multipleGa4Ids } from "./rules/duplicates/multiple-ga4-ids.js"
import { purchaseSentTwice } from "./rules/duplicates/purchase-sent-twice.js"
import { locationMismatch } from "./rules/hygiene/location-mismatch.js"
import { piiInHits } from "./rules/hygiene/pii-in-hits.js"
import { tagErrors } from "./rules/hygiene/tag-errors.js"
import type { CheckResult, Rule, RunInput } from "./types.js"

export type { CheckResult, CheckStatus, DecodedHit, EvidenceRef, Rule, RunInput } from "./types.js"
export { googleConsentFromCcm, isNonGoogle, withoutConsent } from "./consent-state.js"
export { isAdOrAnalyticsCookie } from "./cookies.js"
export { decodeHits } from "./decode.js"
export { pushesByDocument } from "./documents.js"

/**
 * Stored with every check result, so results from older rules can be told apart. Raise it when a
 * released rule set changes: a rule added or removed, or a verdict that can differ for the same run.
 */
export const RULES_VERSION = "3"

export const rules: readonly Rule[] = [
  cookiesWithoutConsent,
  pixelWithoutConsent,
  pixelAfterReject,
  googleWithoutDeniedState,
  defaultAfterTag,
  cookieMissing,
  lostOnRedirect,
  lostAcrossNavigation,
  purchaseMissingFields,
  invalidCurrency,
  noPageView,
  purchaseSentTwice,
  multipleGa4Ids,
  metaLoadedTwice,
  metaEventIdMissing,
  metaEventIdReused,
  piiInHits,
  tagErrors,
  locationMismatch,
]

const byId = new Map(rules.map((rule) => [rule.id, rule]))

export function ruleById(id: string): Rule | undefined {
  return byId.get(id)
}

/**
 * Errors about the banner alone: a banner autoconsent did not find (`CmpNotFound`) or an action that
 * was not seen to take effect (`ConsentNotApplied`). The page, its requests and its cookies were captured
 * in full; only the visitor's choice is unknown.
 */
const CONSENT_ERRORS: ReadonlySet<string> = new Set(["CmpNotFound", "ConsentNotApplied"])

/**
 * Why a run cannot be judged, or `null` when it can. The engine marks a run incomplete whenever it
 * records an error, banner errors included. Treating those as unusable would blank every rule on
 * any site whose banner autoconsent does not know or cannot operate, so such a run is evaluated and
 * the consent rules answer `inconclusive` ("the banner was not found", "the consent choice was not
 * seen to take effect") themselves.
 */
function unusableBecause(capture: CaptureResult): string | null {
  if (capture.complete) return null
  const { errors } = capture
  if (errors.length > 0 && errors.every((error) => CONSENT_ERRORS.has(error.code))) return null
  const first = errors.find((error) => !CONSENT_ERRORS.has(error.code))
  return first === undefined
    ? "the run did not complete"
    : `the run did not complete (${first.code}: ${first.message})`
}

/** One result per rule, in `rules` order. Pure: the same input always gives the same results. */
export function evaluateRun(input: RunInput): CheckResult[] {
  const reason = unusableBecause(input.capture)
  if (reason !== null) return rules.map((rule) => inconclusive(rule.id, reason))
  return rules.map((rule) => rule.evaluate(input))
}
