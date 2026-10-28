import { gcdFinalState, parseGcd } from "@ovriq/zinko-decoders"
import type { Gcd } from "@ovriq/zinko-decoders"
import { isCcmRequest, isGoogle } from "../../consent-state.js"
import { count, hitRef, requestRef } from "../../documents.js"
import { fail, inconclusive, nonEmpty, notApplicable, pass } from "../../results.js"
import type { EvidenceRef, Rule } from "../../types.js"

const id = "consent.mode-v2-incomplete"

interface Signal {
  /** `undefined` when the request has no `gcd` or it is not readable. */
  gcd: Gcd | undefined
  ref: EvidenceRef
  requestId: string
}

export const modeV2Incomplete: Rule = {
  id,
  area: "consent",
  severity: "warning",
  owner: "tag-manager",
  title: "Consent Mode v2 signals missing",
  checkTitle: "Google tags send all four Consent Mode signals",
  why: "Since March 2024 Google Ads and GA4 need ad_user_data and ad_personalization as well as ad_storage and analytics_storage to use data from visitors in the EEA and UK. When the tag never sets the two newer ones, Google treats them as not provided: remarketing audiences and conversion measurement for those visitors are limited or stop.",
  fix: [
    "Set all four types in the default: gtag('consent', 'default', { ad_storage: 'denied', analytics_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' }), before the Google tag loads.",
    "Update all four from your banner's choice. Use a consent platform that is Consent Mode v2 ready, or add ad_user_data and ad_personalization to the update your banner sends.",
  ],
  evaluate(input) {
    // The consent action does not matter here: a signal never set is unset before and after it.
    const hitSignals = input.hits
      .filter((hit) => isGoogle(hit.vendor))
      .map((hit): Signal => ({ gcd: hit.gcd, ref: hitRef(hit), requestId: hit.requestId }))
    const pings = input.capture.requests.filter(isCcmRequest).map((request) => {
      const { searchParams } = new URL(request.url)
      return {
        signal: {
          gcd: parseGcd(searchParams.get("gcd")),
          ref: requestRef(request.id),
          requestId: request.id,
        } satisfies Signal,
        ads: searchParams.get("tid")?.startsWith("AW-") === true,
      }
    })

    const adsPresent =
      input.hits.some((hit) => hit.vendor === "google-ads") || pings.some((ping) => ping.ads)
    if (!adsPresent)
      return notApplicable(id, "no Google Ads hit or Consent Mode ping for an Ads account was sent")

    const signals = [...hitSignals, ...pings.map((ping) => ping.signal)]
    const read = signals.flatMap((signal) =>
      signal.gcd === undefined ? [] : [{ ...signal, gcd: signal.gcd }],
    )
    // A request whose four signals are all unset predates Consent Mode (a tag that ran before the
    // default): consent.default-after-tag reports it, so it is not judged here.
    const active = read.filter(
      ({ gcd }) =>
        gcdFinalState(gcd.adStorage) !== "unset" || gcdFinalState(gcd.analyticsStorage) !== "unset",
    )
    const incomplete = active.filter(
      ({ gcd }) =>
        gcdFinalState(gcd.adUserData) === "unset" ||
        gcdFinalState(gcd.adPersonalization) === "unset",
    )
    const evidence = nonEmpty(incomplete.map((signal) => signal.ref))
    if (evidence !== null) {
      const unset = (pick: (gcd: Gcd) => Gcd["adUserData"]) =>
        incomplete.some(({ gcd }) => gcdFinalState(pick(gcd)) === "unset")
      const names = [
        unset((gcd) => gcd.adUserData) ? "ad_user_data" : null,
        unset((gcd) => gcd.adPersonalization) ? "ad_personalization" : null,
      ]
        .filter((name) => name !== null)
        .join(" and ")
      const requests = new Set(incomplete.map((signal) => signal.requestId)).size
      return fail(
        id,
        `${count(requests, "Google request")} with ${names} never set, while an Ads signal is sent`,
        evidence,
      )
    }
    if (active.length > 0)
      return pass(id, `${count(active.length, "Google request")} set all four Consent Mode signals`)
    if (read.length < signals.length)
      return inconclusive(
        id,
        `${count(signals.length - read.length, "Google request")} had no readable gcd parameter, so the Consent Mode signals could not be read`,
      )
    return notApplicable(id, "no Google request carried a Consent Mode state")
  },
}
