import type { CaptureResult } from "@repo/capture-contract"
import { inconclusive } from "./results.js"
import { lostAcrossNavigation } from "./rules/clickids/lost-across-navigation.js"
import { cookiesWithoutConsent } from "./rules/consent/cookies-without-consent.js"
import { defaultAfterTag } from "./rules/consent/default-after-tag.js"
import { googleWithoutDeniedState } from "./rules/consent/google-without-denied-state.js"
import { pixelAfterReject } from "./rules/consent/pixel-after-reject.js"
import { pixelWithoutConsent } from "./rules/consent/pixel-without-consent.js"
import type { CheckResult, Rule, RunInput } from "./types.js"

export type { CheckResult, CheckStatus, DecodedHit, EvidenceRef, Rule, RunInput } from "./types.js"
export { googleConsentFromCcm, isNonGoogle, withoutConsent } from "./consent-state.js"
export { isAdOrAnalyticsCookie } from "./cookies.js"
export { pushesByDocument } from "./documents.js"

/**
 * Stored with every check result, so results from older rules can be told apart. Raise it when a
 * released rule set changes: a rule added or removed, or a verdict that can differ for the same run.
 */
export const RULES_VERSION = "1"

export const rules: readonly Rule[] = [
  cookiesWithoutConsent,
  pixelWithoutConsent,
  pixelAfterReject,
  googleWithoutDeniedState,
  defaultAfterTag,
  lostAcrossNavigation,
]

const byId = new Map(rules.map((rule) => [rule.id, rule]))

export function ruleById(id: string): Rule | undefined {
  return byId.get(id)
}

/**
 * Why a run cannot be judged, or `null` when it can. The engine marks a run incomplete whenever it
 * records an error, and a banner autoconsent did not find is one (`CmpNotFound`), although the page,
 * its requests and its cookies were captured in full. Treating that as unusable would blank every
 * rule on any site whose banner autoconsent does not know, so such a run is evaluated and the
 * consent rules answer `inconclusive` ("the banner was not found") themselves.
 */
function unusableBecause(capture: CaptureResult): string | null {
  if (capture.complete) return null
  const { errors } = capture
  if (errors.length > 0 && errors.every((error) => error.code === "CmpNotFound")) return null
  const first = errors.find((error) => error.code !== "CmpNotFound")
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
