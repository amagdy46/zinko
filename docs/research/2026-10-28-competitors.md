# Competitive landscape (2026-10-28)

Desk research by an agent, from vendor pages, docs, changelogs and comparison posts. G2 and TrustRadius blocked access, so review sentiment is thin. Many comparison posts are written by vendors who rank themselves first (Trackingplan, NiceLookingData, Web Tonic); treat their rankings as marketing. Prices move; re-check before quoting them.

## Who does what

| Product | For | What it does | Price (2026) | Gap Zinko fills, or Zinko lacks |
|---|---|---|---|---|
| ObservePoint | Enterprise privacy/legal | Crawls, Journeys from global nodes, consent profiles (opted in/out, GPC), tag vs plan, WCAG, alerts | Free ~300 scans; ~$599/mo; ~$2,400/mo; enterprise ~$72k/yr | Reports are CSV/XLSX tables and an expiring view-only link, no branding. Lacks: scheduling, journeys at scale |
| Trackingplan | Agencies, growth teams | Passive real-traffic monitoring against a learned schema, anomalies, PII leaks, Slack/email, AI credits, Omnibug fork, agency resale (30%) | €89 / €699 / €2,000+ per month; compliance add-on €249 | Cannot reproduce a controlled pre-consent run. Lacks: always-on monitoring |
| Tracking Auditor | Agencies | GA4/GTM API (read-only), A–F grade over 5 weighted areas, regime-aware consent scoring (UK/EU opt-in vs US opt-out), business impact and prioritised fix plan, Google Doc report + Sheet register, white-label and before/after on Agency plan; built on Claude | First audit free; £120/audit; £199/mo | No real browser capture per consent scenario. Lacks: config checks, regime scoring, Doc/Sheet export |
| GAfix (NeenOpal, 2025) | SMBs | 11+7 rule checkpoints free, 25+ Pro, PDF, paid fix service | Free 1; $49/audit; fixes $199–499 | Config-side checks |
| GA4 Auditor | Agencies | 100+ data points, 40+ page report, PDF/PPTX/Slides, white-label | $99/audit; $999/yr for 100 | Slides/PPTX export |
| Verified Data | Teams, agencies | ANALYTICS: 60+ checks, AI PII scan, monitoring. CONSENT: crawler (≤100 pages) before consent, after accept, after reject | €99–249; €249–699 per month | Closest overlap on consent; offers a Report API, not a client report |
| DataTrue | Engineering/QA | Tag and data layer regression tests in CI | ~$999 / ~$2,000 per month | CI regression (Zinko v0.4) |
| Tag Inspector (InfoTrust, Feb 2026) | Enterprise governance | 2,500+ tag library, policies, scheduled scans, consent and PII audits | Quote | Vendor coverage |
| Cookiebot, Usercentrics, Didomi, OneTrust | CMP buyers | Cookie inventory and declarations; Didomi ACM is a paid add-on with a free scan page | Bundled with CMP | Mostly list cookies without a verdict; few test pre-consent firing |
| Tag Assistant, Omnibug, Stape GTM Helper, Analytics Debugger | Same consultants, manual | Live single-page debugging; Stape 3.2 (Apr 2026) added a "Scan me" report; Analytics Debugger marks sGTM and modelled hits | Free | Live stateful sessions, sGTM visibility. Tag Assistant's Consent tab is empty without consent mode; Omnibug does not split GA4 batches (Zinko does) |
| NiceLookingData | Agencies | 150+ checks, Gemini fix code, daily pulse, share links, white-label PDF | Free 3/mo; $49; $199 per month | Fix code in findings |
| Consent Mode Monitor, AssertionHub, GetInlytics | Various | Consent mode scan by domain or container; assertion tests | Free to €49/mo | Free instant scan |
| gdpr-cookie-scanner, cookie-audit (open source) | Developers | Playwright cookie scans with a score | Free | Cookie-only; no decoders, rules or UI |

No product yet crawls and fixes tracking with an agent; the Playwright MCP plus LLM pattern appears only in blog experiments.

## Where Zinko wins

- **Consent-scenario evidence.** Hits compared across none, accept, reject and GPC on controlled runs, with the raw request. Lead with "proof, not a score".
- **Open source and self-host.** The open-source alternatives are cookie-only CLIs.
- **BYOK AI that never decides.** Explanations only, per-organization policy.
- **Price.** ObservePoint and DataTrue start at $600–1,000 a month.
- **Deterministic rules with stored wording.** Findings are repeatable and defensible.

## Table stakes Zinko lacks

A client deliverable (M5), re-audit diff (M6), GTM and GA4 config checks, scheduling and alerts, Slides/Sheets exports, a free instant scan, more vendors than four, regime-aware scoring, and a verified cloud deploy. Risks: bot protection breaking captures, Stape and Tag Assistant improving, Trackingplan's agency lock-in.

## Ranked feature ideas

| # | Idea | Evidence | Size | Fits |
|---|---|---|---|---|
| 1 | Shareable client report built on consent-scenario evidence | Tracking Auditor, GA4 Auditor sell it; ObservePoint has none | M | M5 |
| 2 | Re-audit with before/after diff ("fixed 7, new 1") | Tracking Auditor Agency | M | M6 |
| 3 | Consultant-editable narrative: summary override, per-finding notes, hide or accept | Every consultant edits raw output | S | M5 |
| 4 | Exports beyond PDF: CSV audit register first, Slides/PPTX later | GA4 Auditor, Tracking Auditor | S–M | M5, later |
| 5 | Regime-aware scenarios and severity (EU opt-in, US opt-out, GPC) | Tracking Auditor | M | v0.2 |
| 6 | Free public single-URL scan with a shareable grade | Didomi, Tracking Auditor, WebLegal | M | v0.2 |
| 7 | GTM container and GA4 config checks (configured vs fired) | GAfix, GA4 Auditor, Tracking Auditor, NiceLookingData | L | v0.2 |
| 8 | Scheduled audits and alerts | ObservePoint, Trackingplan, Verified Data | L | v0.3 |
| 9 | Logged-in or stateful journeys (cart, checkout) | ObservePoint Journeys, DataTrue | L | v0.2 |
| 10 | Server-side GTM visibility | Analytics Debugger, Stape | M | v0.2+ |
| 11 | Fix snippets in findings (BYOK) | NiceLookingData, Tracking Auditor | S–M | M5 or v0.2 |
| 12 | Tracking plan import and drift | Trackingplan, ObservePoint, DataTrue | L | v0.4 |
| 13 | More vendors (LinkedIn, Pinterest, Snap, Reddit, Microsoft, Hotjar) | Tag Inspector, Verified Data | M, ongoing | v0.2 |
| 14 | Agency portfolio view across clients | Trackingplan, Cookiebot agency tiers | M | v0.3 |
| 15 | Better PII classification | Verified Data, Trackingplan | M | v0.2 |

## What a client report should contain (input to M5)

No sample PDF was obtainable, so this is inferred from product descriptions and audit-report practice.

1. **Cover:** agency and client logos, accent colour, date, scope (site, pages, scenarios, device).
2. **Executive summary, one page:** score with its arithmetic, three to five plain headlines ("Meta fires before consent on 6 of 8 pages"), counts by severity, the worst finding; fixed/new/unchanged once M6 exists.
3. **Scope and method:** pages, scenarios, device, date, rules version, and that no model decides a finding.
4. **Consent-scenario summary:** a compact vendor × scenario matrix, readable in grayscale and print.
5. **Findings by severity:** title, severity glyph and word, area, affected pages, why, fix steps (stored wording), one evidence item, triage (accepted risks show the reason).
6. **Prioritised action plan:** grouped by owner (developer, CMP admin, marketer) or effort and impact. This is what clients act on.
7. **Appendix:** evidence, rules list, severity legend, Could not check and Not evaluated lists.

Delivery: revocable share link first, PDF from a print stylesheet of the same page, personal data never printed, consultant notes stored apart from derived rows, branding (logo, accent, footer, hide "Powered by Zinko"), CSV register before Slides.

## Sources

[Trackingplan pricing](https://www.trackingplan.com/pricing), [Verified Data](https://www.verified-data.com), [ObservePoint reports](https://help.observepoint.com/en/articles/11084158-reports-overview), [ObservePoint privacy guide](https://help.observepoint.com/en/articles/10301978-privacy-compliance-implementation-guide), [Didomi ACM](https://docs.didomi.io/advanced-compliance-monitoring-acm/acm-report-results/compliance-issues-acm), [Stape GTM Helper](https://stape.io/news/stape-gtm-helper-update), [Google consent debugging](https://developers.google.com/tag-platform/devguides/consent-debugging), [Analytics Debugger](https://analytics-debugger.com/en/tools), [NiceLookingData comparison](https://www.nicelookingdata.com/blog/best-ga4-audit-tools-2026), [Web Tonic](https://www.webtonic.io/blog/best-ga4-implementation-tools), [Trackingplan GA4 audit tools](https://www.trackingplan.com/blog/ga-4-audit-tools), [Trackingplan cookie tools](https://www.trackingplan.com/blog/cookies-audit-tools), [SaaSHub Tracking Auditor](https://www.saashub.com/tracking-auditor), [GAfix launch](https://www.techdogs.com/tech-news/globe-newswire/neenopal-launches-gafix-a-smarter-way-to-audit-google-analytics), [Tag Inspector launch](https://www.businesswire.com/news/home/20260223497154/en/InfoTrust-Launches-Tag-Inspector-The-Enterprise-Standard-for-Privacy-Centric-Data-Governance), [G2 Trackingplan](https://www.g2.com/products/trackingplan/reviews), [Gartner ObservePoint](https://external.pi.gpi.aws.gartner.com/reviews/product/observepoint).
