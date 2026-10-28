# @repo/fixtures

Small fake shops, each with one known tracking bug, for exercising Zinko's capture and checks.

```sh
pnpm --filter @repo/fixtures serve                 # http://localhost:4400, each site at /<name>/ (FIXTURES_PORT=4410 for another port)
pnpm --filter @repo/fixtures inspect <site>[/page] [accept|reject]
```

Every site has `/` (home), `/product` and `/thank-you`. The thank-you page fires `purchase` with
`transaction_id: T-1001`, `value: 49.9`, `currency: EUR` (GA4 `purchase`, the Ads conversion `ZinkoConv01`,
Meta `Purchase` with `value` and `currency`, TikTok `CompletePayment`). Every Meta event carries an
`eventID` (`<page>-<Event>-<n>-<nonce>`, the nonce a random base-36 string per document load), every TikTok `ViewContent` and `CompletePayment` an
`event_id` (`<page>-<Event>-<nonce>`), there is one GA4 ID, and GA4 `page_location`
is the site's own URL (gtag drops the port: `http://localhost/clean/`, so compare host names, not `host`). The SDK scripts (gtag.js, fbevents.js,
the TikTok pixel) load from the real CDNs.

Test IDs: GA4 `G-ZINKO00001`, Google Ads `AW-100000001` (conversion label `ZinkoConv01`),
Meta `100000000000001`, TikTok `ZINKOTT0001`.

## Banner

[vanilla-cookieconsent](https://github.com/orestbida/cookieconsent) 3.1.0 (MIT), vendored in
`vendor/cookieconsent/` with its license. autoconsent (16.57.0) supports it with the JSON rule below; it also
supports Klaro, through code in `lib/cmps/klaro.ts` rather than a rule file, which the M1 spike used. Rule:
`rules/autoconsent/cookieconsent3.json`. Buttons: accept `.cm__btn[data-role=all]`,
reject `.cm__btn[data-role=necessary]`.

`vendor/meta-pixel/` and `vendor/tiktok-pixel/` hold the vendors' install snippets as published (TikTok with the test pixel ID filled in); `tags.js` runs them when the site decides to load a pixel.

Defaults (the `clean` site): Consent Mode v2 `default` (all denied) before the Google tag, `update`
on the visitor's choice; Meta and TikTok load only when marketing is accepted.

## Sites

| Site                      | Known bug                                                                                                                                                                                                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `clean`                   | None; the correct baseline.                                                                                                                                                                                                                                                                                              |
| `meta-before-consent`     | Meta `PageView` fires on load, before the visitor chooses, so it fires even when they reject.                                                                                                                                                                                                                            |
| `tiktok-after-reject`     | TikTok loads and fires after any choice, including reject.                                                                                                                                                                                                                                                               |
| `duplicate-purchase`      | `/thank-you` sends `purchase` twice with the same `transaction_id` (the second 1 s later in code; gtag may batch both into one POST while consent is pending).                                                                                                                                                           |
| `ga4-batch`               | Home fires `view_promotion`, `view_item_list`, `select_promotion` in one tick; GA4 sends them as one POST with three lines. Not a bug as such: it tests batch decoding.                                                                                                                                                  |
| `consent-default-late`    | `consent default` is pushed after `config`, so the first `page_view` carries no `gcs`.                                                                                                                                                                                                                                   |
| `lost-gclid`              | Links drop the query string, so `?gclid=` is lost on `/product`; the `conversion_linker` is off, so `_gcl_aw` is never set; 2.5 s after the consent choice the page removes its query string with `history.replaceState` (an SPA "clean URL"), so gtag cannot read the gclid back from the tab's history on later pages. |
| `redirect-gclid`          | `/redirect-gclid/go?gclid=TEST` redirects through `/r` to `/redirect-gclid/` and drops `gclid`. `/redirect-gclid/go-keep-fbclid?gclid=TEST&fbclid=TEST2` does the same but keeps `fbclid`.                                                                                                                               |
| `delayed-pixel`           | Meta loads and sends `PageView` 3 s after the visitor's consent choice, whatever the choice.                                                                                                                                                                                                                             |
| `gpc-echo`                | Home shows the `Sec-GPC` header the server received and `navigator.globalPrivacyControl`; the response also carries `X-Sec-GPC-Received`. The site ignores the signal.                                                                                                                                                   |
| `no-cmp`                  | Pixels and Google tag fire with no banner and no consent default.                                                                                                                                                                                                                                                        |
| `purchase-missing-fields` | The GA4 `purchase` and the Ads conversion carry no `transaction_id` (`value` and `currency` are there).                                                                                                                                                                                                                  |
| `bad-currency`            | Every purchase sends `currency: "eur"` (lowercase).                                                                                                                                                                                                                                                                      |
| `no-page-view`            | The GA4 config has `send_page_view: false`, so no `page_view` is ever sent; other GA4 events (`view_item`, `purchase`) still are.                                                                                                                                                                                        |
| `multiple-ga4`            | A second GA4 ID (`G-ZINKO00002`) is configured on every page, so each page sends a `page_view` to two measurement IDs.                                                                                                                                                                                                   |
| `meta-init-twice`         | The Meta snippet is installed twice (a plugin plus a tag manager): the second copy re-fetches `fbevents.js` and sends a second `PageView` about 1.2 s after the first.                                                                                                                                                   |
| `meta-no-eventid`         | No Meta event carries an `eventID`.                                                                                                                                                                                                                                                                                      |
| `meta-eventid-reused`     | Every Meta event of a page carries the same `eventID` (`evt-1`), and `/product` sends two different `AddToCart`s under it, so Meta keeps the first and drops the second.                                                                                                                                                 |
| `pii-in-url`              | The page URL gets `?email=jane.doe@example.com` (`history.replaceState` before the tags run), so it reaches GA4 `page_location` and Meta `dl`.                                                                                                                                                                           |
| `sgtm-errors`             | GA4 is configured with `transport_url` set to the fixture host, so its hits are `POST /g/collect?v=2&tid=…&en=…` to the fixture server, which answers `500`.                                                                                                                                                             |
| `location-mismatch`       | The GA4 config overrides `page_location` to `https://staging.shop.example/<path>`; nothing navigates there. Meta `dl` stays on the real host.                                                                                                                                                                            |
| `consent-mode-v1`         | Consent Mode v1 only: `default` and `update` set `ad_storage` and `analytics_storage` and never `ad_user_data` or `ad_personalization`, so every Google request carries `gcd=13p3p3l3l5l1` (`l` is "never set") before consent and `13r3r3l3l5l1` after accepting.                                                       |
| `debug-leak`              | A GTM preview snippet and GA4 debug mode left on in production: `gtm.js?id=GTM-ZINKO01&gtm_auth=…&gtm_preview=env-3&gtm_cookies_win=x` loads on every page and the GA4 config sets `debug_mode: true` (its hits carry `ep.debug_mode=true`).                                                                             |
| `tiktok-no-eventid`       | No TikTok event carries an `event_id`.                                                                                                                                                                                                                                                                                   |

Other sites keep the query string on internal links (`keepQuery`), so only `lost-gclid` drops it.

`/g/collect` (any method) answers `500`; only `sgtm-errors` sends there.

`/server-error/` answers `500` with a small HTML page, and any unknown path answers `404` (for example `/nope-404/`); they test how a key page that fails to load is reported. They are not sites and fire no tags.

`/r?to=<url>` answers `302` to any URL; it exists to test the capture engine's SSRF policy.

## inspect

Starts its own server on a free port, opens `<site>` in Chromium, waits 3.5 s, clicks the banner
(`accept` or `reject`; omit for no click), waits 4.5 s and prints every vendor request with its time
(ms since start) and the cookie names. Collection requests (the Task 4 `blockVendorRequests` list)
are answered `204` locally and never sent. First-party collection (`POST /g/collect` on the fixture host) goes to the
fixture server and is shown with its status, `-> 500 (first-party)`. GA4, Ads and Meta lines show
`transaction_id`, `value`, `currency`, `eventID` and the page location. Any other non-script request to a vendor host is also
answered locally and shown as `(unlisted)`; gtag sends some, for example `google.com/rmkt/collect`,
`google.com/ccm/collect` and `ad.doubleclick.net/ccm/s/collect`, which the Task 4 list does not cover.

## Expected `inspect` output

| Run                          | Expected vendor requests                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `clean accept`               | GA4 `page_view` (`gcs=G100`) at about 1 s, before the click; after the click Google Ads, then TikTok and Meta `PageView`. |
| `clean reject`               | Only the GA4 `page_view` (`gcs=G100`); nothing after the click; cookies: `cc_cookie` only.                                |
| `meta-before-consent accept` | Meta `PageView` at about 0.6 s, before the click; after the click the same as `clean accept` without a second Meta hit.   |
| `meta-before-consent reject` | Meta `PageView` at about 0.6 s and the GA4 `page_view`; nothing after the click.                                          |

## Expected result sets

The rules are the 22 in `docs/plans/2026-10-20-m3-rules-and-findings/plan.md`. Every run uses
`--block-vendors`, desktop and mobile alike, scenarios `none`, `accept`, `reject`, `gpc`. A rule not
listed for a site is `pass` or `not_applicable` (n.a.). Facts below were observed with `inspect.mjs`
and Chromium on `localhost`; where a rule's wording left a choice open, the choice is stated.

### Baseline (`clean`)

Every rule is `pass` or n.a. under all four scenarios, on `/`, `/product` and `/thank-you`, except:

- `hygiene.tag-errors`: **inconclusive**, every scenario and page ("Endpoint delivery was not checked because Zinko answered tracking requests locally").

n.a. cases: `consent.pixel-after-reject` outside `reject`; `clickid.cookie-missing` outside `accept` or
without a click ID in the run URL; `clickid.lost-on-redirect` without a click ID; `clickid.lost-across-navigation`
outside journey runs; `coverage.no-page-view` outside `accept`; the purchase rules
(`coverage.purchase-missing-fields`, `coverage.invalid-currency`, `duplicates.purchase-sent-twice`) on pages without a
purchase; the Meta rules when no Meta hit is sent (Meta loads only after marketing consent, so under `none`, `gpc`
and `reject` there are none); `dedup.tiktok-eventid-missing` the same way for TikTok; `debug.preview-or-debug-leak` never (it passes
when no preview or debug marker is sent); `consent.mode-v2-incomplete` when no Google request carries Consent Mode state at all
(`no-cmp`), or no Ads signal is sent.

Behaviour the rules must cope with, all on `clean`:

- **Held GA4 purchase.** Under `none` and `gpc` gtag holds the GA4 `purchase` (only `page_view`, `gcs=G100`, at load).
  `inspect` never sees it, but the capture engine tells the page it is hidden before the `end` snapshot, and gtag then
  sends what it held: the `purchase` (`gcs=G100`) arrives about 5 s in, in the same POST as `user_engagement`. Under
  `reject` and `accept` it sends it after the click (`gcs=G100`). The Ads conversion is sent under every scenario: the
  denied one (`npa=1`, googlesyndication) at load, the granted one (`npa=0`, googleadservices) after `accept` only.
  That is the Ads denied/granted pair, and it passes `duplicates.purchase-sent-twice`.
- **Ads hits with `value` that are not conversions.** On `/product` the Ads remarketing hit carries `value=49.9`
  and `currency` but no `transaction_id`. `coverage.purchase-missing-fields` must treat only Ads hits with a conversion
  label (decoded event `conversion`) as purchases, or `clean/product` fails.
- **Cookies.** `clean` sets no ad or analytics cookie before the choice (`cc_cookie` is not one). After `accept`: `_ga`,
  `_ga_ZINKO00001`, `_gcl_au`, `_ttp` (on `.tiktok.com`), plus `_gcl_aw` when the URL has `gclid` and `_fbc` when it has
  `fbclid`. The real pixel never writes `_fbp` or `_fbc` for these fake pixel IDs (its requests carry `coo=false`), so
  `tags.js` writes `_fbc` itself when the landing URL has an `fbclid`; `_fbp` is never set anywhere.
- **Click IDs on `clean`** (run URL `/clean/?gclid=…&fbclid=…&ttclid=…`, as `clickIds` sends): under `accept`,
  `clickid.cookie-missing` passes for all three vendors (`_gcl_aw`, `_fbc`, `_ttp` all present).

### Existing sites (differences from the baseline)

| Site                   | Rule                                                                                                      | Status       | Where                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `meta-before-consent`  | `consent.pixel-without-consent`                                                                           | fail         | none, accept, reject, gpc (Meta `PageView` at about 0.6 s; under `gpc` the title says the GPC signal was ignored)                                                                                                                                                                                                                                      |
|                        | `consent.cookies-without-consent`                                                                         | pass         | no `_fbp` is set (see above). With an `fbclid` in the run URL the written `_fbc` exists before the click, so it fails in all four scenarios then                                                                                                                                                                                                       |
|                        | `consent.pixel-after-reject`                                                                              | pass         | reject: the only Meta hit is before the click                                                                                                                                                                                                                                                                                                          |
| `tiktok-after-reject`  | `consent.pixel-after-reject`                                                                              | fail         | reject (TikTok loads about 2 s after the click)                                                                                                                                                                                                                                                                                                        |
|                        | `consent.pixel-without-consent`                                                                           | pass         | reject: the hit is after the action; accept: allowed; none, gpc: TikTok never loads                                                                                                                                                                                                                                                                    |
| `duplicate-purchase`   | `duplicates.purchase-sent-twice`                                                                          | fail         | `/thank-you`, all four scenarios (two GA4 purchases, same `transaction_id`, often one POST; under none and gpc gtag holds both and sends them together when the engine hides the page before the `end` snapshot). The Ads conversion is sent once (none, gpc, reject) or as the denied/granted pair (accept), which alone would pass                   |
| `ga4-batch`            | none                                                                                                      |              | baseline (the batch is only a decoder test)                                                                                                                                                                                                                                                                                                            |
| `consent-default-late` | `consent.default-after-tag`                                                                               | fail         | none, accept, reject, gpc, every page                                                                                                                                                                                                                                                                                                                  |
|                        | `consent.google-without-denied-state`                                                                     | fail         | none, accept, reject, gpc (the first `page_view` has no `gcs`)                                                                                                                                                                                                                                                                                         |
|                        | `consent.cookies-without-consent`                                                                         | fail         | none, accept, reject, gpc (`_ga`, `_ga_ZINKO00001` set before consent)                                                                                                                                                                                                                                                                                 |
| `lost-gclid`           | `clickid.cookie-missing`                                                                                  | fail         | accept, run URL with `gclid` (conversion linker off, `_gcl_aw` never set); the Meta and TikTok checks pass. Without click IDs: n.a.                                                                                                                                                                                                                    |
|                        | `clickid.lost-across-navigation`                                                                          | fail         | journey, accept, `/lost-gclid/?gclid=…` then `/lost-gclid/thank-you`: the thank-you Ads conversion has no `gclid` and `_gcl_aw` is missing. Without the URL clean-up gtag would recover the gclid from `navigation.entries()` (`gclaw_src=6_4`) and the rule would pass. `fbclid`: pass (the `_fbc` cookie survives). `clean`, same walk: pass         |
| `redirect-gclid`       | `clickid.lost-on-redirect`                                                                                | fail         | run URL `/redirect-gclid/go?gclid=…` (`/go` -> `/r` -> `/redirect-gclid/`), every scenario. Without a click ID: n.a.                                                                                                                                                                                                                                   |
|                        | `clickid.cookie-missing`                                                                                  | n.a.         | the landing document's URL has no click ID (choice: the rule reads the final URL, not the requested one; otherwise it would fail too)                                                                                                                                                                                                                  |
|                        | `clickid.lost-across-navigation`                                                                          | n.a.         | journey, accept, `/redirect-gclid/go?gclid=…` then `/redirect-gclid/thank-you`: the redirect already dropped the click ID (reported by `clickid.lost-on-redirect`), so the rule skips it: "the redirect already dropped the click ID". One root cause, one finding                                                                                     |
|                        | `clickid.lost-on-redirect`, `clickid.lost-across-navigation`                                              | fail, pass   | journey, accept, `/redirect-gclid/go-keep-fbclid?gclid=…&fbclid=…` then `/redirect-gclid/thank-you`: the redirect drops `gclid` and keeps `fbclid`. `lost-on-redirect` fails for `gclid` only; `lost-across-navigation` skips Google and still checks Meta, so its message names `fbclid` (never `gclid`). `fbclid` survives into `_fbc`, so it passes |
| `delayed-pixel`        | `consent.pixel-after-reject`                                                                              | fail         | reject (Meta `PageView` 3 s after the click)                                                                                                                                                                                                                                                                                                           |
|                        | `consent.pixel-without-consent`                                                                           | pass         | accept and reject: the hit is after the action; none, gpc: Meta never loads                                                                                                                                                                                                                                                                            |
| `gpc-echo`             | none                                                                                                      |              | baseline: the site ignores `Sec-GPC`, but nothing fires without a choice, so no rule can see it                                                                                                                                                                                                                                                        |
| `no-cmp`               | `consent.cookies-without-consent`                                                                         | fail         | none, gpc (`_ga`, `_ga_ZINKO00001`, `_gcl_au`, `_ttp`)                                                                                                                                                                                                                                                                                                 |
|                        | `consent.pixel-without-consent`                                                                           | fail         | none, gpc (Meta and TikTok at load; under `gpc` the title says the signal was ignored)                                                                                                                                                                                                                                                                 |
|                        | `consent.google-without-denied-state`                                                                     | fail         | none, gpc (no consent state)                                                                                                                                                                                                                                                                                                                           |
|                        | `consent.default-after-tag`                                                                               | fail         | none, gpc (no consent default was set)                                                                                                                                                                                                                                                                                                                 |
|                        | `consent.default-after-tag`                                                                               | inconclusive | accept, reject: "the banner was not found"                                                                                                                                                                                                                                                                                                             |
|                        | `consent.cookies-without-consent`, `consent.pixel-without-consent`, `consent.google-without-denied-state` | inconclusive | accept, reject: "the banner was not found"                                                                                                                                                                                                                                                                                                             |
|                        | `consent.pixel-after-reject`                                                                              | inconclusive | reject: "the banner was not found"; n.a. elsewhere                                                                                                                                                                                                                                                                                                     |

### New sites

| Site                      | Rule                               | Status       | Where                                                                                                                                                                                                                                                                                                |
| ------------------------- | ---------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `purchase-missing-fields` | `coverage.purchase-missing-fields` | fail         | `/thank-you`, all four scenarios (the Ads conversion lacks `transaction_id` in every one; the GA4 purchase too under accept and reject). Meta and TikTok are unaffected                                                                                                                              |
| `bad-currency`            | `coverage.invalid-currency`        | fail         | `/thank-you`, all four scenarios (the Ads conversion `currency_code=eur`; GA4 and Meta too wherever they are sent; the TikTok pixel uppercases it to `EUR` itself)                                                                                                                                   |
| `no-page-view`            | `coverage.no-page-view`            | fail         | accept, every page: `/product` (`view_item`), `/thank-you` (`purchase`) and `/` (`user_engagement`, which gtag sends when the engine hides the page before the `end` snapshot; `inspect` does not hide it and sees no GA4 hit on `/`). Other scenarios: n.a.                                         |
| `multiple-ga4`            | `duplicates.multiple-ga4-ids`      | fail         | every page, all four scenarios (both `page_view`s are sent before any choice)                                                                                                                                                                                                                        |
| `meta-init-twice`         | `duplicates.meta-loaded-twice`     | fail         | every page, accept only (Meta loads after marketing consent): two `PageView`s with different `eventID`s; the second `signals/config` request may be served from cache, so the rule must accept two `PageView`s alone. none, gpc, reject: n.a.                                                        |
| `meta-no-eventid`         | `dedup.meta-eventid-missing`       | fail         | accept, `/product` (`ViewContent`) and `/thank-you` (`Purchase`). `/` has only `PageView` (exempt): pass. Other scenarios: n.a.                                                                                                                                                                      |
| `meta-eventid-reused`     | `dedup.meta-eventid-reused`        | fail         | accept, `/product` (two `AddToCart`s with `evt-1`). Different events sharing `evt-1` (`PageView` and `ViewContent`, `PageView` and `Purchase`) are not duplicates for Meta, whose key is pixel, event name and event ID: `/` and `/thank-you` pass. Other scenarios: n.a.                            |
| `pii-in-url`              | `hygiene.pii-in-hits`              | fail         | every page, all four scenarios (email in GA4 `page_location`; under accept also Meta `dl`, the Ads `url` and the TikTok payload). The document URL gains the email by `replaceState`, so the rule must read hit URLs and params, not only the navigation URL                                         |
| `sgtm-errors`             | `hygiene.tag-errors`               | inconclusive | every page, all four scenarios with `--block-vendors`: first-party `POST /g/collect?v=2` is now answered locally with 204, like the other recognized collectors. Without blocking, the fixture returns 500 and this rule fails                                                                       |
| `location-mismatch`       | `hygiene.location-mismatch`        | fail         | every page, all four scenarios (GA4 `page_location` host `staging.shop.example`, document host `localhost`). Meta `dl` matches: pass                                                                                                                                                                 |
| `consent-mode-v1`         | `consent.mode-v2-incomplete`       | fail         | every page, all four scenarios: the Consent Mode ping and the GA4 and Ads hits say `ad_user_data` and `ad_personalization` were never set while an Ads signal (a `ccm` ping to `AW-100000001`) is sent. The rule does not branch on the consent action: an unset signal is unset before and after it |
| `debug-leak`              | `debug.preview-or-debug-leak`      | fail         | every page, all four scenarios (the `gtm.js` request with `gtm_auth` and `gtm_preview`, and the GA4 hits with `ep.debug_mode=true`)                                                                                                                                                                  |
| `tiktok-no-eventid`       | `dedup.tiktok-eventid-missing`     | fail         | accept, `/product` (`ViewContent`) and `/thank-you` (`Purchase`; the pixel sends `CompletePayment` as `Purchase`). `/` has only `Pageview` (exempt): pass. Other scenarios: n.a. (TikTok loads after marketing consent)                                                                              |

Every other rule for the new sites is as in the baseline, including `hygiene.tag-errors` inconclusive when collectors are answered locally.

### Ambiguities the rules must settle

- GA4 sends `page_location` without the port, Meta's `dl` keeps it: compare host names.
- "Landing URL" for `clickid.cookie-missing` on a redirect: the final document URL (above).
- An Ads "conversion" is a hit with a conversion label, not any Ads hit carrying `value`.
- `consent.default-after-tag` is `inconclusive` under accept and reject when the banner is not found (as every consent rule), and fails under none and gpc.
- "Landing URL" for `clickid.lost-on-redirect`: the run's requested URL, compared with the landing document's final URL.
- `hygiene.pii-in-hits` phone names: a name token `tel` or `mobile`, or a token containing `phone`, with a value of 6 to 15
  digits and nothing but phone punctuation; tokens, not substrings, so `hotel` is not `tel`.
- The capture engine hides the page before the `end` snapshot, which makes gtag send what it holds; `inspect` does not, so
  it shows fewer GA4 hits than a capture (the held `purchase` under none and gpc, `user_engagement`).
