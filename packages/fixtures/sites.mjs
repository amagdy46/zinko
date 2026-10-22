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
  cleanUrl: false, // true: the query string is removed from the address bar after the consent choice
  adEntry: false,
  gpcEcho: false,
  purchaseOrderId: true, // false: the GA4 purchase and the Ads conversion carry no transaction_id
  currency: "EUR",
  ga4PageView: true, // false: gtag config sends no page_view
  secondGa4: false, // a second GA4 measurement ID configured on every page
  metaInit: "once", // "once" | "twice"
  metaEventId: "unique", // "unique" | "none" | "shared" (one id on every Meta hit of the page, and /product adds two AddToCart under it)
  piiInUrl: false, // an email appears in the page's query string
  sgtm: false, // GA4 hits go to this host's /g/collect, which answers 500
  locationOverride: false, // GA4 page_location points at another host
}

export const sites = {
  clean: {},
  "meta-before-consent": { meta: "immediate" },
  "tiktok-after-reject": { tiktok: "after-choice" },
  "duplicate-purchase": { purchase: "twice" },
  "ga4-batch": { homeBatch: true },
  "consent-default-late": { consentDefault: "late" },
  "lost-gclid": { conversionLinker: false, keepQuery: false, cleanUrl: true },
  "redirect-gclid": { adEntry: true },
  "delayed-pixel": { meta: "delayed" },
  "gpc-echo": { gpcEcho: true },
  "purchase-missing-fields": { purchaseOrderId: false },
  "bad-currency": { currency: "eur" },
  "no-page-view": { ga4PageView: false },
  "multiple-ga4": { secondGa4: true },
  "meta-init-twice": { metaInit: "twice" },
  "meta-no-eventid": { metaEventId: "none" },
  "meta-eventid-reused": { metaEventId: "shared" },
  "pii-in-url": { piiInUrl: true },
  "sgtm-errors": { sgtm: true },
  "location-mismatch": { locationOverride: true },
  "no-cmp": { cmp: false, consentDefault: "none", meta: "immediate", tiktok: "immediate" },
}
