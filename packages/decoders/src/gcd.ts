import type { Gcd, GcdSignal, GcdState } from "./types.js"

/**
 * Letters of a `gcd` value, one per consent type, each the signal's state after its default and any
 * update. Google does not document the format and says it may change; this table is the community
 * reading (Simo Ahava, Conma, DWC) and agrees with captures of gtag.js on the fixtures
 * (`13p3p3p3p5l1` before consent, `13r3r3r3r5l1` after granting all four).
 */
const NOT_SET: GcdSignal = { default: "unset", update: "unset" }

const LETTERS: ReadonlyMap<string, GcdSignal> = new Map(
  Object.entries({
    l: NOT_SET,
    m: { default: "unset", update: "denied" },
    n: { default: "unset", update: "granted" },
    p: { default: "denied", update: "unset" },
    q: { default: "denied", update: "denied" },
    r: { default: "denied", update: "granted" },
    t: { default: "granted", update: "unset" },
    u: { default: "granted", update: "denied" },
    v: { default: "granted", update: "granted" },
  }),
)

/** Four digit-letter pairs in the order ad_storage, analytics_storage, ad_user_data, ad_personalization. */
const GCD = /^1(\d)([lmnpqrtuv])(\d)([lmnpqrtuv])(\d)([lmnpqrtuv])(\d)([lmnpqrtuv])\d/

/** The state a signal ends in: the update when there was one, else the default. */
export function gcdFinalState(signal: GcdSignal): GcdState {
  return signal.update === "unset" ? signal.default : signal.update
}

export function parseGcd(gcd: string | null | undefined): Gcd | undefined {
  const match = gcd ? GCD.exec(gcd) : null
  if (!gcd || match === null) return undefined
  const signal = (group: number): GcdSignal => LETTERS.get(match[group] ?? "") ?? NOT_SET
  return {
    raw: gcd,
    adStorage: signal(2),
    analyticsStorage: signal(4),
    adUserData: signal(6),
    adPersonalization: signal(8),
  }
}
