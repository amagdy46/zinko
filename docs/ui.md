# Zinko UI

## Direction

Zinko should feel like a professional debugging tool: dense, calm and fast, in the spirit of Linear and Sentry, not a marketing dashboard. Consultants live in it, and their clients see only the polished report.

- Dark and light themes, with light as the default for reports.
- Logo-tinted neutrals (hue 285) with violet `primary` as the only brand accent; `sidebar` supplies the navigation surface. Severity uses `sev-critical` (red), `sev-warning` (amber), `sev-info` (blue); passes and complete runs use `status-pass` (green). Each set has plain text/glyph, `-bg`, `-border` and `-solid` tokens. Tints belong in badges, headers and detail views; rows stay neutral. `destructive` is for destructive actions and form errors.
- System sans (`ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`); no Inter download or font dependency. System monospace for IDs, parameters, URLs and timestamps. The type scale is `text-2xs` 11/16, `text-xs` 12/16, `text-sm` 13/20, `text-base` 14/22, `text-lg` 16/24, `text-xl` 20/28 and `text-2xl` 28/34 (px size/line height). Base radius is 8px (sm 4, md 6, lg 8, xl 12).
- Meaning uses a glyph and a word: Critical a filled diamond, Warning a filled triangle, Info a filled dot; Fail an x ring, Pass and Complete a check ring, Partial a half ring, Could not check a neutral dashed ring, Not applicable a dash ring, Queued a hollow ring, Running a violet spinning arc. Could not check is neutral, never amber or green. Reduced motion stops spinning and pulsing indicators.
- Keyboard-first: `⌘K` command palette, `j`/`k` to move through findings, `e` to open the evidence panel.
- Every number links to the evidence behind it.

## Navigation

```
Workspace switcher
├── Clients                       list → client → sites
│   └── Site
│       ├── Audits                history, compare any two
│       │   └── Audit
│       │       ├── Overview      score, severity counts, top 5 issues, what changed since last run
│       │       ├── Findings      grouped list + evidence panel
│       │       ├── Tag matrix    vendor/ID × page × consent scenario
│       │       ├── Hits          timeline explorer
│       │       └── Report        preview · branding · share link · PDF
│       └── Settings              pages, scenarios, click-id params, allowed domains
└── Settings                      members, branding, LLM keys
```

## Key screens

**1. New audit.** A single form with the start URL, a key-pages textarea, consent scenario checkboxes (none, accept, reject), a viewport choice, and a "simulate ad click" toggle that appends test click IDs and UTMs. The estimated duration updates as you edit. Last-used settings are saved per site.

**2. Audit running.** A grid with one tile per page × scenario. Each tile shows a status, a screenshot thumbnail and a hit count. Findings stream into a side list as rules finish, so you can start reading before the audit is done.

**3. Overview.**
- A health score (0–100, weighted by severity) with its change since the last run.
- Counts by severity and by area (Consent, Click IDs, Coverage, Duplicates, Dedup, Hygiene).
- The "Top issues" list, written in plain business language: "Purchases are counted twice in GA4 (inflates revenue by ~2×)".

**4. Findings.**

| Pane | Shows |
|---|---|
| Left: the list | Severity, title, area, affected page and scenario count, status |
| Right: the selected finding | Explanation, why it matters, fix steps, and evidence tabs: **Hit** (decoded params table), **Request** (raw URL and body), **Screenshot**, **Cookies**, **dataLayer** |

Above the two panes sits the evaluation coverage ("9 of 9 runs evaluated"). Checks that could not run (the page or the banner did not load) are a separate "Could not check" group under the failing list, never counted as passes; an audit with no check results says "Not evaluated" instead of "no findings". The `j`/`k` and `e` shortcuts are not built yet.

Each finding has these actions: mark as accepted risk or fixed (and reopen), copy the fix steps, and open in Hits with the hit selected.

**5. Tag matrix.**
- Rows: each destination (GA4 G-XXXX, Meta pixel 123…, Ads AW-…, TikTok).
- Columns: pages, each split by scenario (∅, ✓ accept, ✗ reject).
- Cells: the events that fired. A red cell means the tag fired when it shouldn't have, for example under reject. An empty amber cell means the tag was expected but didn't fire.
- This is the screen that replaces the consultant's spreadsheet.

**6. Hits explorer.** A virtualized timeline filterable by vendor, event and scenario. Clicking a hit opens a decoded parameter table next to the raw request. `dataLayer` pushes are interleaved, so you can see the push → tag → hit chain.

**7. Report (client-facing).**
- The agency logo and accent color, with Zinko credited in a small footer.
- Sections: summary, score, issues ordered by business impact (each with evidence and fix steps), a tag inventory, and a methodology note.
- A read-only share link at `/share/:token`, and a PDF export. No Zinko chrome or navigation appears in the shared view.

## States to design

- **Empty:** no clients yet, no audits yet.
- **Running:** in progress.
- **Partial:** some runs failed, with the reason shown (bot blocked, timeout, consent banner not found).
- **No LLM key:** static fix templates are used, and a quiet prompt suggests adding a key.
- **Revoked share link.**

## Mockup

An unversioned clickable mockup lives at `mockups/ui.html` (not committed).
