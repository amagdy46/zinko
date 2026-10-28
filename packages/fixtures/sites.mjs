// One entry per fixture site; the keys are the flags `page.mjs` and `shared/tags.js` read.
// Defaults (the `clean` site): CMP banner, Consent Mode default before the Google tag,
// Meta and TikTok loaded only once marketing is accepted, one purchase on /thank-you.
export const defaults = {
  cmp: true,
  consentDefault: "early", // "early" | "late" | "none" | "granted" (everything granted before any choice)
  meta: "consent", // "consent" | "immediate" | "delayed"
  tiktok: "consent", // "consent" | "after-choice" | "immediate"
  purchase: "once", // "once" | "twice"
  homeBatch: false,
  conversionLinker: true,
  keepQuery: true, // internal links carry the query string (gclid) along
  cleanUrl: false, // true: the query string is removed from the address bar after the consent choice
  adEntry: false,
  gpcEcho: false,
  purchaseOnReload: "guarded", // "guarded" | "every-load" | "new-order" (a reload is tracked under another order id): whether /thank-you tracks its order again when it is reloaded
  purchaseOrderId: true, // false: the GA4 purchase and the Ads conversion carry no transaction_id
  currency: "EUR",
  ga4PageView: true, // false: gtag config sends no page_view
  secondGa4: false, // a second GA4 measurement ID configured on every page; "source": only on the first host (`www.` or `localhost`)
  metaInit: "once", // "once" | "twice"
  metaEventId: "unique", // "unique" | "none" | "shared" (one id on every Meta hit of the page, and /product adds two AddToCart under it)
  piiInUrl: false, // an email appears in the page's query string
  sgtm: false, // GA4 hits go to this host's /g/collect, which answers 500
  locationOverride: false, // GA4 page_location points at another host
  consentModeV2: true, // false: Consent Mode v1 only, default and update set ad_storage and analytics_storage and nothing else
  debugLeak: false, // a GTM preview snippet (gtm_auth, gtm_preview) and GA4 debug_mode left on in production
  tiktokEventId: "unique", // "unique" | "none": an event_id on the TikTok pixel's events
  ga4Collector: "google", // "google" | "gateway" (GA4 hits go to this host's /metrics/g/collect, as the Google tag gateway does) | "both" (gtag to Google, plus a second sender posting page_view and purchase to /metrics/g/collect)
  regionFlip: false, // the consent default is denied, then a script grants everything about 3 s later, after the first denied pings with no visitor choice
  consentPersist: true, // false: the banner library's cookie is removed on every load, so the choice is never kept
  consentRestore: "update", // "update" | "never": whether a stored choice is reported to the tags again on later loads
  acceptGrants: "all", // "all" | "analytics" | "ads": what "Accept all" grants
  conflictOnReload: false, // 2 s after a reloaded document loads, a request whose gcs and gcd contradict each other
  cmpBreaksAfterChoice: false, // the banner library's script answers 404 once the visitor's choice is stored
  ghostBanner: false, // once a choice is stored, banner markup is kept in the page but invisible (visibility hidden, as a CMP that animates out leaves it)
  reloadAfterChoice: false, // the banner library reloads the page 1.5 s after the first choice, as some CMPs do
  linker: "none", // "none" | "domains" | "no-accept" | "first-only": the Google tag's cross-domain linker towards the page's other host
  consentScope: "host", // "host" | "domain": the banner library's cookie is host-only, or set for the parent of a www. or checkout. host
  consentCookie: "cc_cookie", // the banner library's cookie name (anything else is a name no CMP list knows)
  consentPath: "/", // "/" | "restricted": the banner library's cookie is limited to /<site>/thank-you
  consentStorage: "cookie", // "cookie" | "localStorage": where the banner library keeps the choice
  cmpDelay: 0, // ms after load before the banner library starts (a CMP that loads late)
  googleLoad: "immediate", // "immediate" | "consent" (basic Consent Mode: the Google tag loads only after an accept)
}

export const sites = {
  clean: {},
  "meta-before-consent": { meta: "immediate" },
  "tiktok-after-reject": { tiktok: "after-choice" },
  "duplicate-purchase": { purchase: "twice", purchaseOnReload: "every-load" },
  "purchase-reload": { purchaseOnReload: "every-load" },
  "purchase-new-order": { purchaseOnReload: "new-order" },
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
  "consent-mode-v1": { consentModeV2: false },
  "debug-leak": { debugLeak: true },
  "tiktok-no-eventid": { tiktokEventId: "none" },
  "ga4-gateway": { ga4Collector: "gateway" },
  "ga4-client-and-server": { ga4Collector: "both" },
  "consent-mode-basic": { googleLoad: "consent" },
  "consent-delayed-cmp": { cmpDelay: 3000 },
  "consent-not-persisted": { consentPersist: false },
  "consent-reverts": { consentRestore: "never" },
  "consent-mixed-grant": { acceptGrants: "analytics" },
  "consent-conflict": { conflictOnReload: true },
  "consent-cmp-404": { cmpBreaksAfterChoice: true },
  "consent-ghost-banner": { ghostBanner: true },
  "consent-reload-after-choice": { reloadAfterChoice: true },
  "consent-subdomain": {},
  "consent-subdomain-shared": { consentScope: "domain" },
  "consent-subdomain-renamed": { consentCookie: "zk_choice" },
  "consent-subdomain-path": { consentScope: "domain", consentPath: "restricted" },
  "consent-subdomain-storage": { consentStorage: "localStorage" },
  "linker-missing": { consentDefault: "granted" },
  "linker-set": { consentDefault: "granted", linker: "domains" },
  "linker-no-accept": { consentDefault: "granted", linker: "no-accept" },
  "linker-ads-only": { acceptGrants: "ads" },
  "linker-two-streams": { consentDefault: "granted", linker: "first-only", secondGa4: true },
  "linker-one-sided": { consentDefault: "granted", linker: "domains", secondGa4: "source" },
  "consent-template-only": { consentDefault: "none", consentRestore: "never" },
  "consent-region-default": { cmp: false, regionFlip: true },
  "no-cmp": { cmp: false, consentDefault: "none", meta: "immediate", tiktok: "immediate" },
  // Changes between audits only through an explicit POST (/_release, /_flaky); see README "Releases and scripted flakiness".
  drift: {
    releases: [
      { meta: "immediate", tiktok: "after-choice", purchase: "twice", piiInUrl: true },
      {
        meta: "consent",
        tiktok: "off",
        piiInUrl: true,
        ga4Id: "G-ZINKO00002",
        productViewItem: false,
        currency: "eur",
      },
      {
        meta: "immediate",
        tiktok: "off",
        piiInUrl: true,
        ga4Id: "G-ZINKO00002",
        productViewItem: false,
      },
    ],
  },
  "flaky-meta": { flaky: { fail: { meta: "immediate" }, pass: {} } },
}
