# Design review (2026-10-28)

An agent screenshotted every screen on `main` at 1440x900 and 390x844 in both themes (72 shots, kept locally) and compared them with Lighthouse, Checkly, Sentry and Linear (web research on PostHog, Plausible, Vercel, Trackingplan and ObservePoint was thin; those references are from general knowledge). About 15 screens were reviewed by eye; members, profile, sign-up, onboarding and the run sheet, and most 390 and dark variants, were checked only for horizontal scroll.

## Assessment

Works: cohesive violet-tinted neutrals; status always a glyph and a word; disciplined vocabulary; good dark mode; the Findings split view (list with a 2px severity rule beside the detail) is the signature screen; the sticky estimate on New audit.

Holds it back:
- **No type hierarchy.** Nearly everything is 13px regular; page titles 20px; section labels ("Counts by area", "Tags seen", "Audits") read as captions; the score is the only large type.
- **No entry point on Overview.** Five equal-weight boxes at the same gap; the amber alert is the loudest element and sits above the score; the score card is mostly empty.
- **Uneven density.** Hits, matrix and site tables are dense; Clients, Overview and Settings airy (a three-column Clients table 1150px wide).
- **Grey prose at result weight** (banner alert, "How to read it", the AI "what is sent" box).
- **Flat light mode.** Page `oklch(0.985)` and white cards: edges nearly invisible; the sidebar is the same near-white.
- **Dark primary glares**; secondary text low-contrast on the black sidebar.
- **Trust bugs:** an audit that checked almost nothing shows "100/100" in full ink, the Clients list "Lowest 100/100" beside "10 checks could not run"; a raw lowercase `completed` badge in the site history (the status badge prints unknown values raw).
- **Hits clips** Status ("Answered l…") with the detail pane open; on mobile the Event column is cut.
- **Mobile audit header** takes about 220px before the tabs; the tab bar scrolls with no cue.

## Improvements

Batches: H = foundations (tokens, type, status, shell), I = score honesty and Overview, J = lists, tables and detail. Deferred: 24, 25.

| # | Batch | Screen | Change | Effort |
|---|---|---|---|---|
| 1 | I | Overview, Clients, Site | A score never claims more than was checked: below full coverage the number is muted with "of n checks resolved" and "Not fully checked"; never a bare 100 without full coverage (Lighthouse, Checkly "degraded") | M |
| 2 | I | Overview | One summary row: the score large (`text-5xl font-semibold tabular-nums tracking-tight`) with its band, three stat tiles (Critical, Warning, Could not check); the run-health alert becomes one inline row under the tabs | M |
| 3 | I | Overview | Caveats (incomplete, banner uncertainty, status line) merged into one "n caveats" disclosure, open only when the score is Incomplete | S |
| 4 | H | App-wide | Three heading styles and a `SectionHeading` block: list-page title `text-2xl font-semibold tracking-tight`, section `text-base font-semibold`, label `text-2xs font-medium uppercase tracking-wide text-muted-foreground` | M |
| 5 | H | Light mode | `--background` about `oklch(0.97 0.004 285)`, white cards with `shadow-xs ring-1 ring-foreground/5`, a sidebar surface slightly darker | S |
| 6 | J | Hits | With the pane open, Status and Consent move into the detail (or the table scrolls with scroll edges); on mobile Run, Vendor, Event only | M |
| 7 | H | Site, Clients | Exhaustive status map (`completed` → Finished); an unknown value is a typed error, never printed raw | S |
| 8 | I | Clients | `max-w-5xl` list pages, a score chip on Last audit, open-findings severity counts, a sparkline of the last five scores | M |
| 9 | J | Findings list | A trailing "8 of 26 runs" figure and a thin proportion bar per row | S |
| 10 | J | Finding detail | A sticky header (severity, title, rule id, triage); Why and Fix side by side at `xl`; first evidence above the fold | M |
| 11 | I | Overview, Findings | Prose at `max-w-prose`, first sentence in foreground, long explanations behind "Learn more" | S |
| 12 | J | Mobile audit header | One row (title, status glyph, a "⋯" for meta) plus `6 open · 4m 56s`; scroll edges on the tab bar | M |
| 13 | I | Overview | "Counts by area" as a strip: one row per area with a segmented bar and counts (text kept for screen readers and grayscale) | M |
| 14 | J | Tag matrix | Labelled control groups ("View", "Pages", "Show"); "How to read it" as a `?` popover; `py-3` rows | S |
| 15 | H | Sidebar | Wordmark, `h-9` items, a clearer active state (`bg-accent font-medium` plus a 2px primary rule), org name under the wordmark | S |
| 16 | H | Dark mode | Primary about `oklch(0.6 0.17 286)` with white text (or `bg-primary/90`); `--muted-foreground` about 0.76 L | S |
| 17 | H | Empty states | A 40px glyph tile, the action at the bottom, a three-step "What happens next" on first run; solid border except Not evaluated | S |
| 18 | H | Auth, onboarding | A card panel, a 40px mark, one line of value copy ("See what your client's tags really do before consent."), a token-only gradient | S |
| 19 | J | New audit | Numbered sections (1 Pages, 2 Scenarios, 3 Options) with `border-t pt-8`; `h-10` Start button | S |
| 20 | J | Run and hit tables | `hover:bg-muted/50`, selected `bg-accent` with a 2px left primary rule, row focus rings | S |
| 21 | J | Settings | Two-column layout (label and description left, control right) at `lg` | M |
| 22 | H | Status badges | One `*-bg`, `*-border`, `*-solid` token trio for status as for severity, identical in both themes | S |
| 23 | H | Motion | `transition-colors duration-150` on rows, a 150 ms fade on sheets and panes (reduced motion respected), skeletons shaped like the real table | S |
| 24 | — | Site, Overview | Score over time and findings by severity over time charts | L |
| 25 | — | App-wide | A keyboard shortcuts sheet and `kbd` hints once `j`/`k` exist | M |

## Principles (proposed for `docs/ui.md`)

1. Lead with one number and one sentence.
2. A score never claims more than was checked.
3. Three text sizes do the work: display for the answer, `text-base font-semibold` for sections, `text-2xs` uppercase for labels.
4. Surface depth is the hierarchy: page, card and sheet are three token levels; alerts are inline rows unless they block.
5. Explain on demand: one sentence visible, detail in a popover or disclosure.
6. Colour is a signal, not decoration; one primary action per screen.
7. Tables adapt, they do not clip.
8. One vocabulary, one component; an unknown status fails loudly.

## For the client report (M5)

The report is a document: a centred `max-w-3xl` column, 14px body at `leading-7`, `text-3xl` cover title; the agency accent only on one bar, links and the score ring, never on severity. Cover with the agency logo, a large title, client and site, date and "Prepared by". A summary hero (score, band with glyph, three tiles) and three to five headlines. Findings as cards with a 2px severity rule, why first, then fix, then one evidence item. An action plan grouped by owner with a checkbox column. Print: near-black text, no tinted paragraph backgrounds, outline-plus-glyph severity chips, `break-before: page` for cover, summary, scope and consent summary, `break-after: avoid` on headings, repeated table headers, 10.5–11pt body, link targets only in the appendix, `page.pdf()` checks in Chromium and Firefox. Fix the raw status badge, the bare 100/100 and the Hits clipping first, because the report reuses those pieces.
