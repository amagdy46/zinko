# Zinko UI

## Direction

Zinko should feel like a professional debugging tool: dense, calm and fast, in the spirit of Linear and Sentry, not a marketing dashboard. Consultants live in it, and their clients see only the polished report.

- Dark and light themes, with light as the default for reports.
- Logo-tinted neutrals (hue 285) with violet `primary` as the only brand accent; `sidebar` supplies the navigation surface. Severity uses `sev-critical` (red), `sev-warning` (amber), `sev-info` (blue); passes and complete runs use `status-pass` (green). Each set has plain text/glyph, `-bg`, `-border` and `-solid` tokens. Tints belong in badges, headers and detail views; rows stay neutral. `destructive` is for destructive actions and form errors.
- System sans (`ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`); no Inter download or font dependency. System monospace for IDs, parameters, URLs and timestamps. The type scale is `text-2xs` 11/16, `text-xs` 12/16, `text-sm` 13/20, `text-base` 14/22, `text-lg` 16/24, `text-xl` 20/28 and `text-2xl` 28/34 (px size/line height). Base radius is 8px (sm 4, md 6, lg 8, xl 12).
- Meaning uses a glyph and a word: Critical a filled diamond, Warning a filled triangle, Info a filled dot; Fail an x ring, Pass and Complete a check ring, Partial a half ring, Could not check a neutral dashed ring, Not applicable a dash ring, Queued a hollow ring, Running a violet spinning arc. Could not check is neutral, never amber or green. Reduced motion stops spinning and pulsing indicators.
- Keyboard-first: `⌘K` / `Ctrl+K` command palette (built); `j`/`k` through findings and `e` for the evidence panel are not built.
- Every number links to the evidence behind it.
- Pages are `mx-auto max-w-6xl space-y-6` for lists and full width for audit pages. Status and severity are never colour alone: a glyph (`StatusGlyph`) and a word sit together, so a grayscale screenshot still tells Fail, Could not check and Pass apart.
- Touch targets are at least 32px (buttons `h-8`, tabs `h-8`, icon buttons `size-8`; dense table rows are 28px with a pointer and 36px below `md`). Every interactive element shows a `ring-ring/50` focus ring on keyboard focus, including focusable tab panels. Colours come from tokens only; the exceptions are the logo mark (`#8b7cf6`) and the `bg-black/50` scrim of dialogs.

## Vocabulary

| Where | Words |
|---|---|
| Severity | Critical, Warning, Info |
| Check result | Fail, Could not check, Pass, Not applicable (the stored word `inconclusive` never appears) |
| Triage | Open, Accepted risk, Fixed |
| Run and audit | Queued, Running, Complete, Partial, Failed, Not audited |
| An audit without check results | Not evaluated, never shown as clean |

## Navigation

```
Sidebar: organization switcher, Find… (⌘K), Clients, Settings, account menu
├── Clients                       list → client → site
│   └── Site                      history of audits, New audit
│       └── Audit                 header, then tabs Overview · Runs · Findings · Tag matrix · Hits
└── Settings                      Profile · Members · AI
```

Below `md` the sidebar is a left `Sheet` behind a menu button in a thin top bar and closes on navigation. Each page opens with a `PageHeader` (breadcrumb, title, meta line, actions).

## Screens as built

**Shell.** The sidebar's top row is the organization switcher (menu: organizations with a check, Members, Create organization). The foot row is the account menu: email, Theme (Light, Dark, System, a radio group, stored per browser), Sign out. The landing page keeps its own theme toggle; the sign-in and sign-up pages follow the stored theme.

**Command palette.** `⌘K` / `Ctrl+K` anywhere in `/app`, or the "Find…" row (the only way on touch). Groups: Actions (New client, which asks for a name), Clients and Sites (organization-scoped names from `searchTargets`), and Switch organization. Esc closes and focus returns to where it was.

**Clients.** A table (Client, Sites, Last audit with a status badge and a relative date, Open findings per severity). The figures come from each site's latest settled, evaluated audit; a running audit shows "Audit running" beside them. "No open findings" appears only at full coverage with nothing that could not be checked; otherwise "0 open · not fully checked", "Not evaluated" or "Not audited". A search box filters by name; "New client" opens a dialog. A fresh organization sees an empty state and a three-step checklist (client, site, audit) that can be dismissed.

**Client and site.** The client page lists its sites (origin in mono, last audit, open findings, audits) and has "Add site"; archive and delete sit in a "…" menu behind a confirm dialog (a client or site with audits can only be archived). The site page has "New audit" in the header and a history table (started, status, runs "9 of 9", findings by severity or "Not evaluated"), Newer and Older.

**New audit.** Three sections: Pages (start URL, key pages with per-line errors and "n of 19"), Scenarios and viewports (checkbox cards with All and Only reject, a Desktop/Mobile toggle), Options (ad-click IDs, journey, and under Advanced, answering tracking requests locally). With journey on, a numbered list shows which pages are walked. A sticky estimate (a bottom bar below `lg`) shows the run count that will be created, the breakdown, the duration at 12.8 s per work unit, and the Start button, disabled with a reason when no scenario or viewport is chosen. Last-used settings prefill.

**Audit and runs.** The header shows the status, a live dot (Connected / Reconnecting) and either progress (a bar, "12 of 44 runs", elapsed, time left, counts of running, partial and failed) or, when finished, a stat strip (Runs, Findings, Duration, Started). A strip names every failed or partial run with its reason. Tabs carry counts. A finished audit with at least one evaluated run opens on Overview (an audit with none, or one still running, opens on Runs; a `view` or `run` in the URL is kept); Runs stays one click away and the completion toast's action is "Overview". The Runs tab has three views: a matrix (page rows, scenario columns grouped by viewport, a glyph and the hit count per cell, a hover card with the screenshot), a list and thumbnails. A cell opens the run sheet (`?run=`, a right `Sheet`, a bottom one below `md`): screenshot, facts, reason, the page's other scenarios, previous and next (arrow keys), Open in Hits and the failing findings that cite the run. A toast announces completion once.

**Overview** (`/overview`). The score as a number out of 100 with a band word and glyph (Critical issues, Needs attention, Minor issues only, No failing checks; never "healthy" or "clean"), and "How this is scored", a popover that prints every line (rule, failing runs of the runs it could be checked on, points), the sum and rounding, the Critical cap (79), what is not scored and the rules versions. Two separate labels follow: "Partly evaluated: 38 of 40 runs" only when some runs have no check results, "Unresolved checks: 1 rule could not be checked, on 9 runs: <check titles>" only when some check was Could not check; "All 40 runs evaluated, every check resolved" only when neither applies. A neutral dashed alert "n failing consent checks rest on an undetected banner" (banner detection uncertainty) appears when the none-scenario consent findings rest on a banner the audit's own accept and reject runs did not find or could not tell; it also adds a clause to "Unresolved checks", and the findings keep their weight. On Findings the list row says "banner not confirmed on n runs" and the finding's run table marks each affected failing run "Banner not detected" or "Banner status unknown" under a note that the finding keeps its severity. Mixed rules versions add "mixed rules versions" beside the band and the Findings alert. After the banner alert, the worst open failing finding is shown in full: severity, title, "failed on 16 of 36 runs where it could be checked, across 3 pages and 4 scenarios", why it matters, the fix steps with a copy button, the stored message of the first failing run, and Open finding and Open in Hits (that run). Triaging it (accepted risk or fixed) promotes the next; with none open the section says "No open failing findings". Tags seen, below the counts, has one link per vendor ("Google Analytics 4: 2 destinations, 3 events") to the Tag matrix, counted over the whole audit. Counts by area is a table (Critical, Warning, Info, Could not check) whose non-zero counts link to Findings with `area` and `severity`; it counts accepted and fixed findings too, as the score does. Not evaluated is an `EmptyState`; a running audit says "Available when the audit finishes".

**Findings.** Coverage is a muted line at full coverage and an alert with a segmented bar when partial or mixed. Tabs Open, Accepted risk and Fixed (counts); severity chips and an Area menu, both in the URL. Failing findings are two-line rows under sticky severity headers with a 2px severity rule; "Could not check (n)" is a collapsible group of neutral rows (dashed glyph, the rule's `checkTitle`, the reason, no severity colour). Selecting a row opens the detail beside the list (`?finding=`), or in a bottom sheet below `lg` with previous and next: severity and rule id, the triage menu (Accept risk asks for a reason in a dialog), why it matters, how to fix it, where it was seen (a table whose selected row drives the evidence tabs; empty tabs are disabled), Open in Hits per evidence item. Not evaluated, running and "not confirmed clean" states are distinct from "No findings".

**Tag matrix** (`/matrix`). Rows are tags (vendor name and destination ID in mono; GA4, Google Ads, Meta, TikTok, then others), 25 per page when the columns are scenarios and 10 when they are pages ("Tags 1–25 of 140", Previous and Next, `tagPage` in the URL). Controls: a Viewport toggle (only when the audit ran more than one), By scenario or By page, a Pages select (all pages, each page by its path with the host added only when two audited URLs share a path, a hash route kept as "/#/cart", or "Journey from /shop"; the full URL is the identity, so `https://a.example/shop` and `https://b.example/shop` stay separate) or a Scenario select, all in the URL. A column header gives the label, the run count and, when some runs are partial or not captured, a partial glyph and "3 complete, 1 partial, 1 not captured". A cell is a button (32px minimum, focus ring) showing up to 4 event chips with `n/m` runs (a single-run column shows `×hits`) and "+n" for the rest; the row's chevron expands every chip. Cell words: "from 2 of 4 runs; 1 partial, 1 not captured" for a gap, "None seen" only over complete runs, "None seen in 7 complete runs; 2 not captured" over a mixed column (dashed glyph), "Not captured" when no run of the column was captured. The cell opens a popover (a bottom sheet below `md`, which returns focus to the cell) with every event and the hits and coverage of each run in a scrolling region with a focus ring; "Open in Hits" is pinned below it and always reachable. When no tag was seen but some runs were partial or not captured, the empty state says the observation is incomplete and counts those runs. A fourth control, Events or Consent state, switches the cells to "Observed consent state before and after the choice": each cell lists the `ad_storage / analytics_storage` combinations the tag's hits carried with their hit counts, split into "Before the choice" and "After the choice", a Mixed tag when there is more than one combination, "No hits" for an empty bucket and "n/a" after the choice when no run of the column had its choice seen (the before bucket is then titled "All hits (no choice seen)"). Meta and TikTok cells say "No consent signal on these hits" and give hit counts. Column headers add the outcomes ("3 runs: Choice: accepted", "No choice made", "Choice not seen (no banner found)") and the banner. The popover offers "Open n hits before the choice" and "after the choice". The footnote says this is the state the hits carried, not the order of the consent commands (`consent.default-after-tag`). The table scrolls inside its container with the first column sticky; the audit tab bar scrolls sideways below `sm` instead of wrapping.

**Hits.** A timeline of decoded hits and `dataLayer` pushes, 200 per page. A search box (event, destination, ids, parameters) and "+ Vendor / Event / Destination / Scenario / Source / Timing / Run" chips (Destination is the exact destination ID, with several values; Timing is "Before the choice" or "After the choice", one at a time, and "before" holds every hit of a run with no consent action); below `md` they sit in a "Filters" sheet. Destination and Timing apply to hits only, like Vendor and Event, so the matrix links add `source=network`. A count line comes from the server ("11 of 342 hits · 40 of 120 pushes"). Pushes show their event name and identical neighbours collapse ("6 pushes · 716–718 ms"). A neutral divider marks each run's consent action once. A row opens the detail (decoded consent as tokens, ids, parameters with copy, the request as Decoded or Raw) beside the list, or in a bottom sheet with previous and next below `lg`.

**Sign-in, sign-up, onboarding, invitations.** A narrow centred card with the brand mark, one sentence and the form. Onboarding creates the first organization ("Signed in as … · Sign out"). The invitation page names the organization and the role.

**Settings.** Profile, Members (a table with avatar, role select for owners and admins, pending invitations with Copy link, an invite dialog) and AI (provider, model, the key's last four characters, test and remove; an Explanations card with two checkboxes, off by default, "Allow AI explanations" with a disclosure of what is sent and never sent shown while it is on, and "Include page paths in explanations" with a warning that paths can contain names or tokens; read-only for members).

## Shared building blocks

`PageHeader`, `EmptyState`, `StatusGlyph` (twelve meanings), `StatusBadge`, `SeverityBadge`, `CheckStatusBadge`, `lib/format.ts` (`relativeTime`, `duration`, `count`), the evidence primitives in `components/evidence.tsx` (`ConsentTokens`, `KeyValueTable`, `RequestView`, `JsonView`, `CopyButton`) and `ConfirmDialog`. A controlled dialog or sheet opened from a button that is not its trigger restores focus itself in `onCloseAutoFocus` (run sheet, finding sheet, filters sheet, triage menu, palette, confirm dialog).

## Not built yet

The report and share link, the `j`/`k`/`e` shortcuts, audit compare, site settings, audit cancel and single-run retry.

## States

- **Empty:** no clients, no sites, no audits, nothing to choose in a filter. Built.
- **Running, partial, failed:** progress header, failure strip with reasons, matrix glyphs. Built.
- **Not evaluated, could not check:** distinct from clean. Built.
- **No LLM key:** static fix text; a neutral row on the AI page. Built.
- **Explanation** (finding detail, failing findings only; a "Could not check" finding has none). Built. Under "How to fix it", a section headed "Explanation":
  - Explanations off for the organization: one neutral line ("AI explanations are switched off ...") and no text, with a link to Settings > AI for owners and admins and "Ask an owner or admin." for members.
  - On, no key: "AI explanations need a key." with the same link or note; cached text written before the key was removed still shows, labelled with its model.
  - On, key, nothing cached: a "What will be sent" collapsible (the policy line and the exact digest as text, with Copy) and the button "Explain with <model>". Nothing is sent before the click. Members may explain.
  - Writing: the button disables and "Writing explanation" (`aria-live="polite"`) shows. When another member is writing the same input the section says so and polls `getExplanation` with backoff (2 s doubling to 15 s) until the text appears.
  - Shown: summary, What we saw, Likely causes, Suggested steps (each with a where badge and one Copy), How to verify, and a footer with an "AI-written" badge, "Written by <model> (<provider>), <time>. Asked by <name>." and "The rule, not the model, decided this finding." The text is plain text: markup in an answer shows literally. Owners and admins get "Regenerate", or "Regenerate with <current model>" when the text came from another model.
  - Failures are a destructive `Alert` with a plain message each: hourly limit (try again later, the button stays off), model did not answer in time, provider error, answer could not be used (nothing stored), and a refused request. Retry is the same button.
- **Revoked share link:** not built (no sharing yet).

## Mockup

An unversioned clickable mockup lives at `mockups/ui.html`, and the verification screenshots of the refreshed screens at `mockups/ui-refresh-demo/` (neither committed).
