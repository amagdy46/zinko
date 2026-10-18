# Zinko: what we're building

## Who it's for

The primary user is a **tracking consultant or agency** auditing client sites, someone who today pays $50–150/h for this work or does it by hand in Tag Assistant and Omnibug.
The secondary user is the agency's **client**, who sees the white-label report.

## The job

> "A client says their conversions don't match. Within an hour I want to know what's broken, prove it with evidence, and hand them a report with the fixes."

## v0.1 (MVP): web app

1. **Workspace:** sign up, create an agency workspace, and invite teammates.
2. **Clients and sites:** add a client, then add one or more sites to it.
3. **Run an audit:**
   - Enter the start URL and up to 20 key page URLs. Funnel steps are entered manually as a list of URLs for now.
   - Choose consent scenarios from no interaction, accept all, and reject all.
   - Choose desktop or mobile.
   - Turn landing click IDs (`gclid`, `fbclid`, `ttclid`, `utm_*`) on or off.
4. **Live progress:** see each page and scenario as it runs, with a screenshot thumbnail.
5. **Findings:** findings are grouped by severity and category. Each one shows:
   - the evidence: the decoded hit, the raw request and a screenshot
   - why it matters
   - fix steps written by the LLM if a key is configured, or a static template otherwise
   - a triage status: open, accepted risk, or fixed.
6. **Tag matrix:** every vendor and destination ID, showing which events fired on which page in which consent scenario. This is the "what fires where" view consultants currently build in spreadsheets.
7. **Hit explorer:** a per-run timeline of decoded hits and `dataLayer` pushes. Think of it as Omnibug in the browser, filterable.
8. **Report:** a white-label report with the agency's logo, accent color and client name. It can be shared through a link that holds a secret token and can be revoked, or exported to PDF.
9. **Re-run and compare:** run the audit again and see findings marked new, fixed or unchanged since the last run.

### Checks in v0.1 (about 20 deterministic rules)

| Area | Rules |
|---|---|
| Consent | Ad or analytics cookies set before consent; non-Google pixels firing before consent or after reject; Google hits without denied `gcs` before consent; `consent default` arriving after the Google tag |
| Click IDs | `gclid`, `fbclid` and `ttclid` lost across navigation; `_gcl_aw`, `_fbc` and `_ttp` cookies missing after consent; IDs missing on the conversion page |
| Coverage | `purchase` missing `transaction_id`, `value` or `currency`; currency format invalid; key page with no page_view |
| Duplicates | Same event fired twice for one action; multiple GA4 IDs on one page; Meta Pixel initialized twice |
| Dedup | Meta browser `eventID` missing, or not unique per action |
| Hygiene | PII (email or phone) in URLs or params; tags failing with 4xx/5xx; hits sent from staging hosts |

Vendors in v0.1: GA4, Meta Pixel, Google Ads, TikTok. LinkedIn comes in v0.2.

## Not in v0.1

| Feature | When |
|---|---|
| GTM / GA4 / Meta API connections (configured vs fired) | v0.2 |
| Agent-driven funnel discovery: find add-to-cart and checkout automatically | v0.2 |
| Scheduled audits, volume-drop alerts, Slack | v0.3, the first paid cloud feature |
| Tracking plan (YAML), plan drift, GitHub Action | v0.4 |
| Billing | When the cloud version launches |
| CLI | The capture and rules packages are CLI-ready, so this is cheap to add at any point |
| Ad tracker, product analytics | Not planned |

## Success for v0.1

- You deliver 3 paid client audits using only Zinko output.
- An audit of 10 pages × 3 consent scenarios finishes in under 5 minutes.
- Every finding links to evidence, and none relies only on the LLM's judgment.
