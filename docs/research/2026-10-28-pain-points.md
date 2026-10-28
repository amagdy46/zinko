# What consultants struggle with (2026-10-28)

Desk research by an agent. Reddit and Measure Slack were unreachable, so practitioner blogs (Loves Data, Stape, MeasureU, Trackingplan, Elevar, CMP vendors, some vendor-affiliated) stand in for forum threads. Frequency and severity are a qualitative ranking. Regulatory amounts and dates come mostly from law-firm and vendor summaries: check the primary press release before quoting them in copy.

## Top pain points

| # | Pain point | Severity | Zinko today | Sources |
|---|---|---|---|---|
| 1 | Consent default arrives after Google tags, or the CMP loads after GTM | Very frequent, high | Yes (`consent.default-after-tag`); inconclusive when GTM's template sets the default without a `dataLayer` push | [Cookie-Script](https://cookie-script.com/guides/google-consent-mode-v2-troubleshooting-top-10-mistakes), [Loves Data](https://www.lovesdata.com/blog/troubleshooting-consent-mode/) |
| 2 | The banner shows, but reject or opt-out does not stop trackers | Frequent, fines | Yes for reject; partly for CMPs autoconsent cannot operate | [Orrick, Tractor Supply](https://www.orrick.com/en/Insights/2025/10/CPPA-Imposes-the-Largest-Administrative-Fine-to-Date-What-Companies-Need-to-Know), [CNIL/Shein](https://captaincompliance.com/education/frances-cnil-slams-google-and-shein-with-record-fines-for-cookie-violations/) |
| 3 | GPC ignored | Rising fast | Yes (`gpc` scenario) | [Sourcepoint, Sephora](https://sourcepoint.com/blog/sephora-settles-in-gpc-enforcement-sweep/) |
| 4 | Meta and TikTok browser/server dedup fails (missing or mismatched event IDs) | Very frequent, high | Partly: browser `eventID` only, server half invisible | [Meta docs](https://developers.facebook.com/docs/marketing-api/conversions-api/deduplicate-pixel-and-server-events/), [TikTok](https://ads.tiktok.com/help/article/event-deduplication) |
| 5 | Double-counted purchases (Shopify Customer Events plus GTM, hardcoded gtag, client tag left on after sGTM) | Very frequent, high | Partly (`duplicates.*`); not cross-source or reload | [ClickMinded](https://www.clickminded.com/shopify-google-analytics/), [Stape](https://stape.io/blog/google-tag-manager-shopify-set-up) |
| 6 | Enhanced conversions send empty or malformed data | Frequent, high | No | [Taggrs](https://taggrs.io/google-enhanced-conversions-2026-update/), [Google](https://support.google.com/google-ads/answer/11956168) |
| 7 | Click IDs and sessions lost across redirects, domains and payment gateways (`_gl`) | Very frequent | Partly (`clickid.*`, no `_gl` continuity) | [Easyinsights](https://easyinsights.ai/blog/why-multi-domain-checkouts-break-tracking-and-how-to-reconnect-event-flows-end-to-end/) |
| 8 | Silent breakage after a release, no alerting | Very frequent, high | Partly (compare M6, scheduling v0.3) | [Trackingplan](https://www.trackingplan.com/blog/why-monitor-analytics-tags-accurate-marketing-data-en) |
| 9 | Shopify checkout extensibility (sandboxed pixels, purchase before consent) | Frequent in ecommerce | Partly | [Elevar](https://www.getelevar.com/?p=10872) |
| 10 | Server-side GTM upkeep and consent forwarding | Frequent | Partly | [Ecorpit](https://ecorpit.com/ecorpit-server-side-tagging-consent-measurement-service-india-2026/) |
| 11 | GA4 unassigned and self-referral traffic | Very frequent | No (needs the GA4 connector) | [Optizent](https://www.optizent.com/blog/ga4-data-quality-audit-why-a-perfectly-configured-property-can-still-produce-bad-data/) |
| 12 | PII in URLs and parameters | Frequent, high | Yes | [Google redaction](https://support.google.com/analytics/answer/13544947?hl=en) |
| 13 | Google's June 2026 consent change: `ad_storage` alone gates Ads data; `ad_user_data` and `ad_personalization` matter more | New, high | Partly: reads `gcs`; check `gcd` parsing | [PPC Land](https://ppc.land/google-strips-analytics-of-ad-data-authority-in-june-2026-consent-overhaul/), [Didomi](https://www.didomi.io/blog/google-consent-mode-2026-changes) |
| 14 | Google Ads conversion statuses are opaque, diagnostics lag 48–72 h | Very frequent | No | [Google](https://support.google.com/google-ads/answer/10989978) |
| 15 | Audits are slow, flat checklists; clients ask what to fix first | Constant | Core thesis; report and compare to build | [MeasureU](https://measureu.com/ga4-audit-ai-claude/) |

## Rule ideas

P1 means build next. Each needs a fixture and README result set first (`AGENTS.md`, Rules).

| Rule | Detects | Pri | New capability |
|---|---|---|---|
| `consent.mode-v2-incomplete` | `gcd` shows `ad_user_data` or `ad_personalization` unset when Ads signals are present | P1 | Decoder |
| `debug.preview-or-debug-leak` | `gtm_debug`, `gtm_preview`, `debug_mode` or test transaction ids in production hits | P1 | None |
| `duplicates.client-and-server-ga4` | Same event and `transaction_id` sent to Google and to a first-party collector | P1 | Decoder recognises GA4 payloads on first-party paths (tag gateway, sGTM), which also removes false "no GA4" results |
| `dedup.tiktok-eventid-missing` | TikTok events without `event_id`; inconclusive unless a server path is evident | P1 | None |
| `consent.not-persisted-across-navigation` | After accept, the next page or a reload shows the banner again or reverts to denied | P1 | Reload step |
| `consent.lost-across-subdomain` | Consent granted on `www`, denied on checkout subdomain | P1 | Cross-host journey step |
| `clickid.crossdomain-linker-missing` | Link to a domain the page measures lacks `_gl`, client id changes | P1 | Journey across domains |
| Initiator attribution (annotation, not a verdict) | Was the tag loaded by GTM, hardcoded, or a third-party script: tells the reader who must fix it | P1 | CDP request initiator |
| `duplicates.purchase-on-reload` | Thank-you page reload re-sends the same `transaction_id` | P2 | Reload step |
| `coverage.enhanced-conversions-payload` | Empty or non-hash enhanced-conversion field, or plaintext email | P2 | Form input in journeys |
| `consent.cmp-loads-after-gtm` | CMP script after `gtm.js` with no earlier default | P2 | Fold into `default-after-tag` |
| `consent.banner-asymmetric` | No reject on the first layer; inconclusive unless sure | P2 | Banner DOM and screenshot |
| `consent.regional-default-granted` | No banner and granted default from an EEA vantage point | P2 | Geo simulation (spike) |
| `consent.mode-classified` (informational) | Basic vs advanced consent mode | P2 | None |
| `gpc.confirmation-missing` | California visible GPC confirmation (single source, verify first) | P3 | DOM text |

## How audits are delivered

Observed: spreadsheet checklists with working/missing/broken status are the baseline; paid gigs promise a plain executive summary, per-issue severity and a prioritised fix list; clients ask what to fix first; specific wording ("purchase missing on checkout confirmation after release") beats generic; regulators now order repeat tracking audits (Tractor Supply, Ford), so a dated, re-runnable evidence record is itself a deliverable.

For the report (M5): plain-language top problems with business impact first, an owner and effort hint per finding (CMP, GTM, theme developer, server team), a developer appendix and CSV export, every finding scoped to its run and limits, a dated record.

For compare (M6): states beyond new/fixed/unchanged (regressed, verdict changed, not comparable when rules version, region or banner detection differ), per-finding re-verify, specific regression wording, separate real change from flaky verdicts, accepted risks carry over.

## Regulatory timeline

| Date | Event | Source |
|---|---|---|
| 2025-05 | CPPA fines Todd Snyder $345,178 (opt-out signals ignored, vanishing banner) | [Orrick](https://www.orrick.com/en/Insights/2025/05/UPDATE-Todd-Snyder-CPPA-Enforcement-Action-What-Companies-Need-to-Know) |
| 2025-09 | CNIL fines Google €325M and Shein €150M (trackers before consent) | [Security Affairs](https://securityaffairs.com/181911/laws-and-regulations/frances-cnil-fined-google-379m-and-shein-175m-for-breaching-cookie-rules.html) |
| 2025-09 | California, Colorado, Connecticut joint GPC sweep | [Captain Compliance](https://captaincompliance.com/education/enforcement-escalates-on-gpc-non-compliance-with-privacy-sweet-in-ca-co-and-ct/) |
| 2025-09-30 | CPPA fines Tractor Supply $1.35M; order requires signal recognition, symmetric choice, multi-year tracking audits | [Orrick](https://www.orrick.com/en/Insights/2025/10/CPPA-Imposes-the-Largest-Administrative-Fine-to-Date-What-Companies-Need-to-Know) |
| 2026-01-01 | More US state laws; Delaware and California GPC rules reported | [Privacy Law Map](https://privacylawmap.com/deadlines) |
| 2026-02 to 04 | UK DUAA PECR changes and ICO guidance cover pixels, not just cookies | [Pearl Cohen](https://www.pearlcohen.com/uk-ico-finalizes-new-cookies-and-pixel-tracking-guidelines/) |
| 2026-03-05 | CPPA fines Ford $375,703; must audit tracking for GPC | [UniConsent](https://www.uniconsent.com/blog/ford-ccpa-fine-opt-out-friction) |
| 2026-06-15 | Google: `ad_storage` alone gates Ads data from the Google tag | [PPC Land](https://ppc.land/google-strips-analytics-of-ad-data-authority-in-june-2026-consent-overhaul/) |
| 2026-06-18 | EU Council drops browser consent signals (Art. 88b) from the Digital Omnibus; single-click refusal stays | [PPC Land](https://ppc.land/eu-council-drops-cookie-signal-after-google-lobbying-eur-40-50-bn-at-stake/) |

Messaging: "Regulators are running browser tests; run the same test first." "A banner is not consent." "GPC is already law in a dozen states." "Your Consent Mode changed in June." Never claim a legal verdict: Zinko shows technical behaviour, not a GDPR violation.
