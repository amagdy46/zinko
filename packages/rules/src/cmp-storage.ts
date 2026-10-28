/**
 * Where the CMPs we can name keep the visitor's choice, keyed by the name the capture reports
 * (`consent.cmp`, the autoconsent rule name). Only cookies appear: snapshots hold no
 * `localStorage`, so a CMP that keeps its choice there gets no entry for it. An entry is here only
 * after its source was fetched (the date is `fetched`); a CMP that is not listed is unknown and the
 * rules name no cause for it. Names match exactly.
 */
interface CmpStorage {
  readonly cmps: readonly string[]
  readonly cookies: readonly string[]
  readonly source: string
  readonly fetched: string
}

const ENTRIES: readonly CmpStorage[] = [
  {
    cmps: ["Cybotcookiebot", "cookiebot.be"],
    cookies: ["CookieConsent"],
    source: "https://www.cookiebot.com/en/developer/ (code samples read the CookieConsent cookie)",
    fetched: "2026-10-28",
  },
  {
    cmps: ["didomi"],
    cookies: ["didomi_token", "didomi_dcs", "euconsent-v2"],
    source: "https://developers.didomi.io/cmp/web-sdk/consent-notice/cookies",
    fetched: "2026-10-28",
  },
  {
    cmps: ["cookieconsent3"],
    cookies: ["cc_cookie"],
    source: "https://github.com/orestbida/cookieconsent src/utils/constants.js (COOKIE_NAME)",
    fetched: "2026-10-28",
  },
  {
    cmps: ["Klaro"],
    cookies: ["klaro"],
    source: "https://klaro.org/docs/integration/annotated-configuration (storageName default)",
    fetched: "2026-10-28",
  },
]

/** The cookie names a known CMP stores its choice in, or `undefined` when the CMP is not listed. */
export function consentCookieNames(cmp: string | null): readonly string[] | undefined {
  return cmp === null ? undefined : ENTRIES.find((entry) => entry.cmps.includes(cmp))?.cookies
}
