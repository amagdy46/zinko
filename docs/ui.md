# Zinko UI

## Direction

Zinko should feel like a professional debugging tool: dense, calm and fast, in the spirit of Linear and Sentry, not a marketing dashboard. Consultants live in it, and their clients see only the polished report.

- Dark and light themes, with light as the default for reports.
- Neutral greys with one brand accent. Severity colors carry meaning: critical red, warning amber, info blue, pass green. Color is never decorative.
- Monospace for IDs, parameters and URLs; Inter for everything else.
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

Each finding has three actions: mark as accepted risk, copy the fix steps, and open in Hits.

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
