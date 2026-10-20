# @repo/fixtures

Small fake shops, each with one known tracking bug, for exercising Zinko's capture and checks.

```sh
pnpm --filter @repo/fixtures serve                 # http://localhost:4400, each site at /<name>/
pnpm --filter @repo/fixtures inspect <site>[/page] [accept|reject]
```

Every site has `/` (home), `/product` and `/thank-you`. The thank-you page fires `purchase` with
`transaction_id: T-1001`, `value: 49.9`, `currency: EUR`. The SDK scripts (gtag.js, fbevents.js,
the TikTok pixel) load from the real CDNs.

Test IDs: GA4 `G-ZINKO00001`, Google Ads `AW-100000001` (conversion label `ZinkoConv01`),
Meta `100000000000001`, TikTok `ZINKOTT0001`.

## Banner

[vanilla-cookieconsent](https://github.com/orestbida/cookieconsent) 3.1.0 (MIT), vendored in
`vendor/cookieconsent/` with its license. autoconsent (16.57.0) has no generic Klaro rule (only a
site-specific one for `escaparium.ca`), so Klaro was skipped. `cookieconsent3` is the maintained self-hostable open-source CMP it supports (the older `cookieconsent2` and `tarteaucitron` also have rules), so it is the pick. Rule:
`rules/autoconsent/cookieconsent3.json`. Buttons: accept `.cm__btn[data-role=all]`,
reject `.cm__btn[data-role=necessary]`.

`vendor/meta-pixel/` and `vendor/tiktok-pixel/` hold the vendors' install snippets as published (TikTok with the test pixel ID filled in); `tags.js` runs them when the site decides to load a pixel.

Defaults (the `clean` site): Consent Mode v2 `default` (all denied) before the Google tag, `update`
on the visitor's choice; Meta and TikTok load only when marketing is accepted.

## Sites

| Site                   | Known bug                                                                                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clean`                | None; the correct baseline.                                                                                                                                             |
| `meta-before-consent`  | Meta `PageView` fires on load, before the visitor chooses, so it fires even when they reject.                                                                           |
| `tiktok-after-reject`  | TikTok loads and fires after any choice, including reject.                                                                                                              |
| `duplicate-purchase`   | `/thank-you` sends `purchase` twice with the same `transaction_id` (the second 1 s later in code; gtag may batch both into one POST while consent is pending).          |
| `ga4-batch`            | Home fires `view_promotion`, `view_item_list`, `select_promotion` in one tick; GA4 sends them as one POST with three lines. Not a bug as such: it tests batch decoding. |
| `consent-default-late` | `consent default` is pushed after `config`, so the first `page_view` carries no `gcs`.                                                                                  |
| `lost-gclid`           | Links drop the query string, so `?gclid=` is lost on `/product`; the `conversion_linker` is off, so `_gcl_aw` is never set.                                             |
| `redirect-gclid`       | `/redirect-gclid/go?gclid=TEST` redirects through `/r` to `/redirect-gclid/` and drops `gclid`.                                                                         |
| `delayed-pixel`        | Meta loads and sends `PageView` 3 s after the visitor's consent choice, whatever the choice.                                                                            |
| `gpc-echo`             | Home shows the `Sec-GPC` header the server received and `navigator.globalPrivacyControl`; the response also carries `X-Sec-GPC-Received`. The site ignores the signal.  |
| `no-cmp`               | Pixels and Google tag fire with no banner and no consent default.                                                                                                       |

Other sites keep the query string on internal links (`keepQuery`), so only `lost-gclid` drops it.

`/r?to=<url>` answers `302` to any URL; it exists to test the capture engine's SSRF policy.

## inspect

Starts its own server on a free port, opens `<site>` in Chromium, waits 3.5 s, clicks the banner
(`accept` or `reject`; omit for no click), waits 4.5 s and prints every vendor request with its time
(ms since start) and the cookie names. Collection requests (the Task 4 `blockVendorRequests` list)
are answered `204` locally and never sent. Any other non-script request to a vendor host is also
answered locally and shown as `(unlisted)`; gtag sends some, for example `google.com/rmkt/collect`,
`google.com/ccm/collect` and `ad.doubleclick.net/ccm/s/collect`, which the Task 4 list does not cover.

## Expected `inspect` output

| Run                          | Expected vendor requests                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `clean accept`               | GA4 `page_view` (`gcs=G100`) at about 1 s, before the click; after the click Google Ads, then TikTok and Meta `PageView`. |
| `clean reject`               | Only the GA4 `page_view` (`gcs=G100`); nothing after the click; cookies: `cc_cookie` only.                                |
| `meta-before-consent accept` | Meta `PageView` at about 0.6 s, before the click; after the click the same as `clean accept` without a second Meta hit.   |
| `meta-before-consent reject` | Meta `PageView` at about 0.6 s and the GA4 `page_view`; nothing after the click.                                          |
