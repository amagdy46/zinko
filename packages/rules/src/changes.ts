/**
 * The rules whose verdict can differ for the same run in each `RULES_VERSION`, and the rules removed
 * or reintroduced in it. A comparison of two audits judged by different versions trusts a rule only
 * when no version in between lists it (`ruleChangedBetween`). A rule that was only ever added, or
 * only ever removed, needs no entry: it ran on one side of the comparison only, which the
 * comparison already reports as added or removed.
 *
 * Raise `RULES_VERSION` and list the rules here in the same change. A removed rule is listed in the
 * version that removed it and, if it comes back, again in the version that reintroduced it, so an
 * audit from before the removal never compares with one from after the return.
 *
 * Versions 1 and 2 are the least reliable boundaries: version 1 stayed in place while the consent
 * rules were being verified (M3), so audits stored as version 1 were not all judged by the same code.
 */
export const RULE_CHANGES: Readonly<Record<string, readonly string[]>> = {
  // 6cdbc2c and the commits before it since the first stored check results: an unconfirmed consent
  // choice (`not-applied`) is now inconclusive for every consent-timeline rule, Meta retransmissions
  // need an identical payload, and tag errors use the shared collection-request list
  "2": [
    "clickid.cookie-missing",
    "clickid.lost-across-navigation",
    "consent.cookies-without-consent",
    "consent.default-after-tag",
    "consent.google-without-denied-state",
    "consent.pixel-after-reject",
    "consent.pixel-without-consent",
    "dedup.meta-eventid-reused",
    "duplicates.meta-loaded-twice",
    "duplicates.purchase-sent-twice",
    "hygiene.tag-errors",
  ],
  // 9f0c3cf: a click ID the redirect already dropped is not reported a second time
  "3": ["clickid.lost-across-navigation"],
  // 4d8bb78: a purchase sent once to Google and once to a first-party collector is no longer
  // "sent twice" (`duplicates.client-and-server-ga4` reports it)
  "5": ["duplicates.purchase-sent-twice"],
  // ab7e9c7: a flip from denied to granted without a choice is inconclusive
  "6": ["consent.mode-classified"],
  // versions 7 and 8 only added rules (`consent.not-persisted-across-navigation`,
  // `duplicates.purchase-on-reload`), which need no entry; 9: a purchase after the reload that
  // matches nothing earlier is inconclusive, where version 8 passed it
  "9": ["duplicates.purchase-on-reload"],
}

/**
 * Whether a rule's verdicts from the given versions can differ for the same run: some version after
 * the lowest of them, up to and including the highest, lists the rule. `judgedBy` is every version
 * that judged the rule in either audit.
 */
export const ruleChangedBetween = (ruleId: string, judgedBy: readonly string[]): boolean => {
  const versions = judgedBy.map(Number)
  const lowest = Math.min(...versions)
  const highest = Math.max(...versions)
  return Object.entries(RULE_CHANGES).some(
    ([version, ruleIds]) =>
      Number(version) > lowest && Number(version) <= highest && ruleIds.includes(ruleId),
  )
}

/**
 * Rules whose verdict was seen to change between runs of one unchanged page (a consent default that
 * depends on a geo lookup or on which Google hit goes first: Allbirds, M3). A change in one of them
 * is labelled Low confidence in a comparison. The value says why, for whoever edits the list.
 */
export const VOLATILE_RULES: Readonly<Record<string, string>> = {
  "consent.default-after-tag":
    "GTM's consent template can set the default without a dataLayer push, and the order of the first Google hits varies",
  "consent.mode-classified":
    "a region-based default (denied, then granted without a choice) flipped the verdict between runs of one page",
  "consent.google-without-denied-state":
    "depends on which Google hit goes first, which varies between loads",
}
