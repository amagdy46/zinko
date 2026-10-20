// One entry per fixture site; the keys are the flags `page.mjs` and `shared/tags.js` read.
// Defaults (the `clean` site): CMP banner, Consent Mode default before the Google tag,
// Meta and TikTok loaded only once marketing is accepted, one purchase on /thank-you.
export const defaults = {
  cmp: true,
  consentDefault: "early", // "early" | "late" | "none"
  meta: "consent", // "consent" | "immediate" | "delayed"
  tiktok: "consent", // "consent" | "after-choice" | "immediate"
  purchase: "once", // "once" | "twice"
  homeBatch: false,
  conversionLinker: true,
  keepQuery: true, // internal links carry the query string (gclid) along
  adEntry: false,
  gpcEcho: false,
}

export const sites = {
  clean: {},
  "meta-before-consent": { meta: "immediate" },
  "tiktok-after-reject": { tiktok: "after-choice" },
  "duplicate-purchase": { purchase: "twice" },
  "ga4-batch": { homeBatch: true },
  "consent-default-late": { consentDefault: "late" },
  "lost-gclid": { conversionLinker: false, keepQuery: false },
  "redirect-gclid": { adEntry: true },
  "delayed-pixel": { meta: "delayed" },
  "gpc-echo": { gpcEcho: true },
  "no-cmp": { cmp: false, consentDefault: "none", meta: "immediate", tiktok: "immediate" },
}
