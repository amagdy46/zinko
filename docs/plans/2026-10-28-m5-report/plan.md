---
type: plan
status: proposed
design: ../../vision.md
---

# M5 Report Plan

**Goal:** A consultant opens a finished audit, lands on a Report tab that shows exactly what the client will read (cover, one-page summary, scope and method, a consent-scenario summary, findings with stored wording and one safe evidence item, an action plan grouped by who fixes it, an appendix), edits the summary and adds notes, then shares it as a revocable link with the agency's logo, accent colour and footer, prints it to PDF, or exports a CSV register. Demo: "Send a white-label report to a client" (`docs/roadmap.md`, M5).
**Approach:** The report is a read model over rows M3 and M4 already write (`finding`, `check_result`, `hit`, `run`, `finding_triage`, the score and the Overview queries), built on read by org-scoped server functions into one validated JSON document, `ReportModel`. The consultant's work is stored apart from derived rows: `org_branding` (per organization), `report_edit` and `report_finding_edit` (per audit, like `finding_triage`, never touched by the workflow). A share link points at a **frozen snapshot**: "Share" copies the model (and the logo) into `report_snapshot`, and the public page `/r/<token>` reads only that row, so a client sees what the consultant published on a date, not whatever the rows say today, and the public path never runs the heavy queries. The link holds a 256-bit secret of which only the SHA-256 is stored. PDF is the browser's print of the same page through a print stylesheet; a server-rendered PDF through the capture engine is deferred, with the reasons below. The trade-off: a snapshot can go stale (the page says so, and the Report tab shows "unpublished changes" by comparing a content hash), and a new version means a new link; in return the record is dated, immutable, cheap to serve and cannot leak a later edit. The supported maximum is the M4 one, 168 runs, and Task 14 measures the draft build, publish and public read against it.

Design sources: `docs/product.md` (Report), `docs/roadmap.md` (M5 row, "Left over from M4"), `docs/vision.md` (principles 1, 2 and 4; "Report (M5)"; "M4 demo"), `docs/ui.md` (vocabulary, shared blocks, "Revoked share link: not built"), `docs/research/2026-10-28-competitors.md` ("What a client report should contain", ranked ideas 1, 3, 4), `docs/research/2026-10-28-pain-points.md` ("How audits are delivered"), `docs/plans/2026-10-27-m4-matrix-overview-llm/{plan,review-r1,review-r2}.md` (format, org scoping, derived rows, the performance method), `AGENTS.md`, and the code as of `c87572b`: `packages/db/src/{audit,rules,explain,ai}-schema.ts`, `packages/core/src/{storage,storage-security,audit}.ts`, `packages/rules/src/{index,types}.ts` and `rules/consent/pixel-without-consent.ts`, `packages/llm/src/{digest,vocab}.ts`, `apps/web/src/server/{findings,findings-data,overview,matrix-data,consent-context,audit-data,audits,explain,server-fn,org-access,storage,storage-route,routes,ai-policy,ai-policy-data}.ts`, `apps/web/src/server.ts`, `apps/web/src/lib/{health-score,audit-labels,tag-matrix,format}.ts`, `apps/web/src/routes/app/audits/*`, `apps/web/src/routes/app/settings*`, `apps/web/src/components/{finding-detail,evidence,tag-matrix,status-glyph}.tsx`, `apps/web/src/styles.css`, `apps/browser/src/{server,capture,engines/playwright}.ts` and `Dockerfile`, `infra/alchemy.run.ts`.

## Global constraints

- **No unit or integration tests** (`AGENTS.md`, current phase). Each task is verified by running the real thing: the dev server in a browser at 1440x900 and 390x844, both themes through the real theme menu, `psql`, `curl -i`, `zinko capture`, and for print a throwaway Playwright script in `$TMPDIR` (not committed). Report the command and what was seen. Screenshots go to `$TMPDIR/m5t<task>-*.png` (`TMPDIR=$HOME/.cache/tmp`).
- `pnpm check && pnpm typecheck && pnpm build` exit 0 with zero warnings after every task (real exit codes).
- **Docs move with the feature.** Every task ends by updating the matching row in `docs/vision.md` ("Report (M5)") and, where it applies, `docs/ui.md` and `AGENTS.md`, with what was built and how it was verified. Task 15 only sweeps and closes.
- **Rules decide; wording is stored.** The report prints the wording stored on `finding` and `check_result` (title, why, fix, check title, owner), never the live `@repo/rules` registry (`AGENTS.md`, Database). The only places that may read the registry are the ones that already do (`checkTitleOf`'s last fallback). No model decides or writes anything in the report (decision below).
- **Never print personal data.** The report may contain: stored rule wording, `check_result.message` (rules already promise not to repeat personal data), counts, vendor names, destination IDs in a vendor's known format, standard event names, cookie families by label, consent states and timing, and page paths **without query or fragment**. It may not contain: a hit parameter, a click ID, a cookie value, a full URL with a query, a raw request, a screenshot. Evidence comes from `buildDigest` in `@repo/llm` (the same minimiser the AI explanation uses), not from `getEvidence`. Text the consultant types (summary, notes, the accepted-risk reason, agency name, footer) is printed as typed; the editors warn when it looks like an email address or a phone number (`scrubPersonalData` changes it) but do not block, because an agency footer legitimately holds an address.
- **Org scoping and the 404 rule.** Every management query filters by `org_id` and reaches runs, findings and hits through `auditInOrg(orgId, auditId)`; snapshots and links are reached by `shareInOrg(orgId, id)`. An id from another organization is a 404, never a 403. The public path has no organization: its only key is the token, and an unknown or malformed token is a 404 whose body and headers do not depend on why.
- **Roles on the server.** Branding is owner/admin only (`isManager(role)`, `Forbidden` otherwise). Any member may edit the report text, hide findings, create and revoke share links and export the CSV (open question 1).
- **Derived rows.** Nothing new is a derived row. `report_snapshot` and `report_share` are records of a human act (surrogate ids, `defaultNow()` are fine); `report_edit`, `report_finding_edit` and `org_branding` are people's work and the workflow never touches them. The two additive owner columns on `check_result` and `finding` follow the existing rule: `persist-<n>` writes `check_result.owner` from the rule, `finish` copies it onto `finding`, nothing is joined back to the registry.
- **Vocabulary** (`docs/ui.md`): Critical, Warning, Info; Fail, Could not check, Pass, Not applicable (never "inconclusive"); Open, Accepted risk, Fixed; Not evaluated is never clean; "No failing checks", never "healthy" or "clean". The report never claims a legal verdict: it describes technical behaviour (fixed sentence in "Scope and method").
- **No new dependency.** shadcn components in `components/ui`, the shared blocks (`PageHeader`, `EmptyState`, `StatusGlyph`, `SeverityBadge`, `CheckStatusBadge`, `lib/format.ts`, `components/evidence.tsx`), `react-dom` and `lucide-react` that already ship. No PDF library, no image library, no QR code, no markdown renderer. The logo is validated by reading its first bytes.
- **No inline `style` props.** The accent colour is one of eight presets selected by a `data-accent` attribute whose variables live in `styles.css` (Task 2); there is no free hex input.
- Never log or return the share token after creation; never log the signing secret. `TMPDIR=$HOME/.cache/tmp`. No sudo. Never push without asking. Migrations are generated, never edited. Never commit `.env`.

### Working in the worktree

The worktree is `/home/pokerface/Documents/Projects/zinko.m5-report` (branch `m5/report`). Copy `.env` from the main checkout once (`cp ../zinko/.env .env`; it is gitignored), run `pnpm install`, `pnpm build` and `pnpm typecheck` once so `check` has its `dist` folders. The services are the usual ones (`CONTRIBUTING.md`): Postgres (`docker compose up -d`, 127.0.0.1:5432), fixtures (`pnpm --filter @repo/fixtures serve`, :4400), the engine (`ALLOW_PRIVATE_NETWORKS=true PORT=8080 pnpm --filter browser start`, :8080), the app (`BROWSER_URL=http://localhost:8080 pnpm dev`, :1337). Only one dev server can hold :1337: if the main checkout's is running, ask before stopping it. **Use a separate database** for this branch so generated migration timestamps cannot collide with another branch's: create `zinko_m5` (`docker compose exec db createdb -U postgres zinko_m5`, adjust to the compose service name), point `DATABASE_URL` in the worktree's `.env` at it, then `pnpm db:migrate`.

## Scope and non-goals

In scope: branding settings and logo; the report page and its model; consultant edits; frozen snapshots and revocable share links with a public route; print-to-PDF; the CSV register; owner hints as stored rule metadata; the entry point and first-run help.

Not in scope: re-run diff and "fixed / new / unchanged" in the report (M6; the report model has no slot for it yet and says nothing about prior audits); a server-rendered PDF; PPTX, Slides or Sheets export; screenshots or any raw evidence in the report; AI text in the report; a client portal or client accounts; email delivery of the link (the consultant sends it); a custom accent hex; client logos; per-link analytics beyond "opened n times, last opened"; scheduled reports; report templates or languages other than English.

## Decisions

| Question | Decision | Why |
|---|---|---|
| Live or frozen shared report | **Frozen snapshot, created by "Share".** The Report tab itself is live (a draft built on every load) and says "Unpublished changes" when its content hash differs from the latest snapshot | Triage, notes, hidden findings and branding all change after a consultant sends something. A regulator-facing or contract-facing record needs a date and must not move under the reader (the pain-points research: repeat tracking audits are now ordered). A snapshot also makes the public path one indexed row read, so a leaked or hammered link costs one cheap query, not the 168-run aggregates. Cost: a new version needs a new link; old links show "A newer version was published on <date>" and stay valid until revoked |
| PDF | **Browser print of the same page through a print stylesheet.** Server-side `page.pdf()` is deferred | See "PDF: print stylesheet or the capture engine" below |
| Executive-summary headlines | **Deterministic, from stored findings**, plus one coverage line; the consultant can replace the whole summary with their own text | The research asks for 3 to 5 plain headlines; templates over `title`, counts and scope need no model and are repeatable |
| AI text in the report | **Not included in M5** | The explanation is per finding, cached under a policy, and written for the consultant, not the client. A client document under the agency's name should not carry text nobody reviewed. The consultant can copy an explanation into a note (the Explain panel has Copy). Revisit as an explicit per-finding "include" toggle (open question 7) |
| Owner hint | **Static rule metadata `owner`** (`consent-platform`, `tag-manager`, `developer`), stored on `check_result` and `finding` like the other wording; a per-finding override lives in `report_finding_edit` | The owner is a property of the rule's fix, so it belongs next to `fix`. Storing it keeps old audits' wording stable and keeps the registry out of display. Rows written before the column are null and read "Owner not assigned" until the consultant sets one; no hand-written backfill (migrations are generated, and a re-evaluation would change `rules_version` semantics). Verdicts do not change, so `RULES_VERSION` stays |
| Hide from report | **"Leave out of the detail"**: the finding's detail and action-plan entry are omitted; the score, its arithmetic and the counts still include it, and the appendix says "Left out of the detail by the author (n): titles" | A report that silently drops a failing finding while printing a score that counts it would be dishonest and would disagree with the app. Hiding is for noise and false positives the consultant has judged; accepting a risk or marking it fixed is the way to state a conclusion |
| Accent colour | **Eight presets**, each with white text on it and itself on white at 4.5:1 or better, verified by a contrast script in Task 2 | Constrained choices cannot produce an unreadable report, need no validation UI and need no inline style |
| Logo | PNG, JPEG or WebP, at most 512 KB, checked by magic bytes, stored in `Storage` under a server-generated key, shown through a signed URL | See Security |
| Share link lifetime | Choice of 7, 30 (default), 90 days or never; revocable at any time; the full link is shown **once** at creation (only the hash is stored), with a label such as "Sent to Jane at Acme" for recognising it later | Matches "store only a hash". The cost (no "copy link again") is stated in the dialog; sending again is one click |
| Who may share | Any member | Same trust level as triage and the Explain button; branding stays manager-only. Open question 1 |
| Report forced light | The report always renders with the light tokens (`.report-paper` re-declares the light variables), also in the dark app theme | Clients and printers get one look; `docs/ui.md` already says light is the default for reports |

### PDF: print stylesheet or the capture engine

| | Print stylesheet (browser Save as PDF) | `page.pdf()` in `apps/browser` |
|---|---|---|
| Fit with the engine | none needed | The engine has one route, `POST /capture` (`src/server.ts`), and every navigation goes through the egress proxy and `url-policy.ts`, which refuse private and local addresses (`ALLOW_PRIVATE_NETWORKS=true` exists only for fixtures). To print `/r/<token>` the engine would have to reach the app's own origin, so the SSRF policy needs an exception, or the app must hand over HTML |
| Capacity | the viewer's own browser | The three engines (`BROWSER_ENGINES`) are shared FIFO through `AdmissionGate` with up to 168-run audits. A PDF would queue behind captures, or need a second admission class |
| Delivery | one click, no round trip | Worker to engine to R2 to download, with its own timeout and failure states |
| Not yet proven | needs Chromium print CSS checked (Task 8) | The container image has never been run (`docs/roadmap.md`, M1) |
| Fidelity | Chromium and Firefox both honour `@page`, `break-inside`, `print-color-adjust`; browser headers and footers show the page URL (which holds the token) unless the user switches them off | Deterministic output, page numbers, no URL, same on every machine |

**Decision:** print stylesheet for M5. The page is built so that print is a first-class output (A4, light, no chrome, sections break at sensible places, a running footer with page numbers in browsers that support `@page` margin boxes), and the toolbar has "Save as PDF" (calls `window.print()`) with one line of help: "Turn off headers and footers in the print dialog so the link is not printed". **Deferred (recorded in `docs/vision.md`):** `POST /pdf` on the engine, which needs (a) a single-use, short-lived print URL minted by the Worker, (b) an explicit allow for the app origin in `url-policy.ts` limited to `/r/*` print requests, (c) its own admission class so PDFs never wait behind audits, (d) a size and time cap, and (e) the container image proven first. Cloudflare Browser Rendering is the alternative that avoids (b) and (c).

## Data model

All new tables in a new `packages/db/src/report-schema.ts`, exported from `packages/db/src/index.ts`; the owner columns go in `rules-schema.ts`. Each is added by the task that needs it, with `pnpm --filter @repo/db db:generate` then `pnpm db:migrate`.

```ts
// Task 1. Additive, nullable: rows written before the column exist stay null.
check_result.owner: text          // 'consent-platform' | 'tag-manager' | 'developer' | null
finding.owner: text               // copied by finish from the newest rules version's check results

// Task 2. One row per organization; a missing row means BRANDING_DEFAULTS.
org_branding: orgId text PK references organization on delete cascade,
              agencyName text not null,          // 1..80, shown on the cover and in the footer
              accent text not null,              // an id from ACCENTS (lib/report-accent.ts)
              footerText text,                   // <= 300, plain text
              showPoweredBy boolean not null default true,
              logoKey text,                      // Storage key, null = no logo
              logoType text,                     // 'image/png' | 'image/jpeg' | 'image/webp', sniffed
              updatedBy text not null, updatedAt timestamptz not null
// BRANDING_DEFAULTS = { agencyName: <organization name>, accent: 'violet', footerText: null,
// showPoweredBy: true, logoKey: null }, exported once from server/branding-data.ts (the same
// "kept out of the file routes import" rule as ai-policy-data.ts).

// Task 9. The consultant's text, per audit. Written only by saveReportEdit / saveFindingEdit.
report_edit: auditId uuid PK references audit on delete cascade, orgId text not null,
             summary text,                       // <= 2000; null = use the generated summary
             updatedBy text not null, updatedAt timestamptz not null
report_finding_edit: auditId uuid references audit on delete cascade, orgId text not null,
             ruleId text not null,               // no foreign key to finding, like finding_triage
             note text,                          // <= 1000, shown under the finding
             hidden boolean not null default false,
             owner text,                         // override of the stored owner hint
             updatedBy text not null, updatedAt timestamptz not null,
             PK (auditId, ruleId)

// Task 10. A frozen report and the links that open it.
report_snapshot: id uuid PK defaultRandom, orgId text not null,
             auditId uuid not null references audit on delete cascade,
             version integer not null,           // 1, 2, ... per audit, assigned under a row lock on the audit
             modelVersion integer not null,      // REPORT_MODEL_VERSION when it was built
             model jsonb not null,               // ReportModel, validated on write and on read
             contentHash text not null,          // sha256 of the canonical model without publishedAt
             logoKey text,                       // a copy of the logo under reports/<id>/logo
             publishedBy text not null, publishedAt timestamptz not null defaultNow,
             unique (auditId, version), index (orgId, auditId)
report_share: id uuid PK defaultRandom, orgId text not null,
             snapshotId uuid not null references report_snapshot on delete cascade,
             tokenHash text not null unique,     // sha256 hex of the token; the token is never stored
             label text,                         // <= 80
             expiresAt timestamptz,              // null = never
             createdBy text not null, createdAt timestamptz not null defaultNow,
             revokedAt timestamptz, revokedBy text,
             viewCount integer not null default 0, lastViewedAt timestamptz,
             index (orgId, snapshotId)
```

- A snapshot is never updated. Deleting an organization removes everything through the cascades. Nothing deletes a snapshot otherwise (storage is small: the model is under 150 KB, the logo copy under 512 KB).
- `report_snapshot.logoKey` is a **copy** (`Storage.get` then `put` under `reports/<snapshotId>/logo`), because replacing the organization's logo deletes the old object and a published report must keep showing the logo it was sent with.
- `viewCount` and `lastViewedAt` are updated by the public read at most once a minute per link (the `where` clause compares `lastViewedAt`). Link-preview bots and mail scanners open links too, so the number says "opened", not "read".

## The report

### `ReportModel`

One `Schema`-validated JSON document, `REPORT_MODEL_VERSION = 1`, in `apps/web/src/lib/report-model.ts` together with the pure functions that make it (`headlinesOf`, `actionPlanOf`, `contentHashOf`). It has no internal ids (no run, org, audit or user ids; rule ids are public) and no user names.

```ts
interface ReportModel {
  modelVersion: 1
  generatedAt: string                      // ISO; excluded from the content hash
  branding: { agencyName: string; accent: AccentId; footerText: string | null
              showPoweredBy: boolean; hasLogo: boolean }        // the logo itself is a signed URL added at render
  cover: { clientName: string; siteName: string; host: string
           auditedAt: string                                    // finishedAt, else createdAt
           scope: { pages: string[]                             // paths, query and fragment dropped, start page first
                    scenarios: string[]; viewports: string[]; journey: boolean; clickIds: boolean } }
  summary: { source: 'generated' | 'author'
             text: string | null                                // the author's text, else null
             score: HealthScore                                 // the M4 value, including lines, cap, versions
             counts: { critical: number; warning: number; info: number; couldNotCheck: number
                       acceptedRisk: number; fixed: number }
             headlines: string[]                                // 1 to 5, deterministic
             coverage: { evaluatedRuns: number; totalRuns: number; unresolvedRules: number; ruleTitles: string[]
                         bannerUncertainRuns: number }
             worst: { ruleId: string; severity: Severity; title: string; scopeLine: string } | null }
  method: { rulesVersions: string[]; scoreVersion: number; runs: { complete: number; partial: number; failed: number }
            mixedVersions: boolean }
  consent: { scenarios: string[]                                // audited, in none, accept, reject, gpc order
             rows: { vendor: string; cells: { scenario: string; runsWithHits: number; runs: number
                                              hits: number; hitsAfterChoice: number; captured: 'all' | 'some' | 'none' }[] }[] }
  findings: ReportFinding[]                                     // failing, severity then share; hidden ones removed
  leftOut: { ruleId: string; title: string }[]                  // hidden by the author
  actionPlan: { owner: OwnerId | null; items: { ruleId: string; severity: Severity; title: string
                firstStep: string }[] }[]                       // open failing findings only
  appendix: { couldNotCheck: { ruleId: string; checkTitle: string; reason: string | null; runs: number }[]
              notEvaluated: { page: string; scenario: string; viewport: string; reason: string }[]
              rules: { ruleId: string; title: string; area: string; severity: Severity; version: string
                       pass: number; fail: number; couldNotCheck: number; notApplicable: number }[] }
}
interface ReportFinding {
  ruleId: string; severity: Severity; area: string; title: string; why: string; fix: string[]
  owner: OwnerId | null; ownerSource: 'rule' | 'author' | 'none'
  failingRuns: number; knownRuns: number; pages: number; scenarios: string[]
  bannerUncertainRuns: number
  triage: { status: 'open' | 'accepted_risk' | 'fixed'; reason: string | null }
  note: string | null
  evidence: { items: SafeEvidence[]; caption: string } | null  // one case, from buildDigest, at most MAX_EVIDENCE items
}
```

How it is built (`apps/web/src/server/report-data.ts`, `buildReport(orgId, auditId)` as an Effect, in the shape of `findingsOf`):

1. `findingsOf` and `healthScore` (the Overview's inputs), the audit, site, client and decoded `AuditConfig`; `org_branding` (or defaults); `report_edit` and `report_finding_edit`; triage from `findingsOf`.
2. **Consent summary**: one grouped query over `hit` joined to `run` for the audit: `vendor, scenario, count(distinct run_id), count(*), count(*) filter (where after_consent_action)`, plus per-scenario run counts by capture state from `run`. `captured` is `all` when every run of the scenario is complete, `some` when any is partial or not captured, `none` when no run was captured. Viewports are merged; the scope line says which were audited.
3. **Evidence**: for each failing finding, the first failing run (run order) that has evidence is loaded through the shared `digestOf` assembly (extracted from `explain.ts` in Task 6, no behaviour change), and `buildDigest(finding, [thatRun], { includePagePaths: true })` gives one case: hits as vendor, destination in known format, standard event, timing (before the choice, after the choice, no choice) and consent states; requests as category and status; cookies by family label; pushes as the command only. Page labels are paths without query. Captures are read once per distinct run, four at a time.
4. **Headlines** (`headlinesOf`, pure): the first four open failing findings by severity, then share of runs, as `"<title>: <failing> of <known> runs where it could be checked, on <pages> pages (<scenario labels>)"`; accepted-risk and fixed findings are not headlined; if the audit has no failing finding the first headline is "No failing checks in <n> runs"; the last line is always the coverage line ("<evaluated> of <total> runs evaluated; <n> checks could not be resolved" or "every check resolved"). When the author supplies a summary, `text` is shown and the headlines are still shown beneath it, labelled "Generated from the findings".
5. **Action plan** (`actionPlanOf`, pure): open failing findings (not hidden, not accepted, not fixed), grouped by effective owner (override, else stored owner, else null "Owner not assigned"), groups in the order consent platform, tag manager, developer, not assigned, items by severity then share of runs; `firstStep` is `fix[0]`.
6. **Appendix**: Could not check from the `findingsOf` uncertainty and inconclusive findings (stored `checkTitle`, first reason); Not evaluated from runs with no check results (page path, scenario, viewport, the run's `failure` code); rules list from the audit's own `check_result` rows grouped by rule (stored title, area, severity, version, counts by status), so a removed rule still appears.
7. `contentHashOf(model)` is sha256 of `canonicalJson` (exported from `@repo/llm`) of the model with `generatedAt` removed.

Dates are formatted by one helper, `reportDate(iso)`, as `28 October 2026 (UTC)`, so server and browser render the same text and an A4 print never depends on the reader's locale.

### Sections and what each shows

Rendered by `components/report/report-view.tsx` from `ReportModel` only (no fetching), with `mode: "consultant" | "client"`. Consultant mode adds edit buttons and dims left-out findings; client mode is exactly what the snapshot shows. Section numbers are in headings and the print table of contents is not needed (a seven-section document).

1. **Cover.** Agency logo and name, "Tracking audit", client name, site (name and host), "Audited on <date>", a scope block (pages count and list, scenarios, viewports, journey and click IDs on or off), and "Prepared by <agency>". A draft shows a neutral "Draft" label (consultant mode only); a snapshot shows "Version n, published <date>".
2. **Summary (one page).** The score number with its band word and glyph; the arithmetic as a compact table (the first five score lines, "and n more lines in the appendix", the sum, rounding and the Critical cap line); the two honesty labels from the Overview ("Partly evaluated", "Unresolved checks", "mixed rules versions", "n failing consent checks rest on an undetected banner"); counts by severity and by triage; the author's summary or the generated one; the headlines; the worst finding as one line with its scope. Designed to fit one A4 page (verified in Task 4).
3. **Scope and method.** Pages (paths), scenarios and what each does (from `SCENARIOS` hints), viewports, run counts, date, the rules versions, the score version and its caveats, and fixed sentences: "Every finding comes from a deterministic rule applied to what the browser recorded. No model decides whether a check passes or fails." and "This report describes technical behaviour on the audited pages and scenarios. It is not legal advice and not a statement of legal compliance." When consent findings under the no-interaction scenario rest on a banner the audit did not detect, the note says exactly that (the M4 wording) and does not claim a region.
4. **Consent scenarios.** The vendor by scenario table: each cell is a glyph, a word and a count ("Fired", "None seen", "Not captured"; "3 of 4 runs", "14 hits after the choice" for accept and reject, "9 hits" for none and gpc), readable in grayscale. A footnote says a hit is not a verdict and points to the findings.
5. **Findings.** Failing findings by severity under severity headers (glyph and word). Each card: severity badge, title, area, "failed on n of m runs where it could be checked, across p pages (scenario list)", why it matters, how to fix it (the stored steps), the **one safe evidence item** as a small table ("Vendor / Event / Destination / Timing / Consent state") with its caption (page path, scenario), the owner, the triage state (Open, Accepted risk with the reason, Fixed with "marked fixed by the author, not re-verified"), the banner note when it applies, and the author's note. Findings the author left out are listed in the appendix only.
6. **Action plan.** Groups by owner, each item a one-line title with a severity glyph, the first fix step and a link to its card. Accepted-risk and fixed findings are listed after the groups as "Not in the plan" with their state.
7. **Appendix.** A. Could not check (checks that could not be resolved, with the reason; never shown as passes). B. Not evaluated (runs with no check results, never clean). C. Left out of the detail by the author (titles). D. Full score arithmetic. E. Rules in this audit (title, area, severity, version, pass / fail / could not check / not applicable counts). F. Legend (severity glyphs, check results, triage words, the scenarios).

The footer on every printed page and at the end of the screen: the agency's footer text, "Page n of m" where the browser supports `@page` margin boxes, and "Powered by Zinko" unless switched off in branding.

## Share link: security design

- **Token.** `zr1_` + 43 base64url characters from 32 bytes of `crypto.getRandomValues` (256 bits). Pure helpers in `packages/core/src/share-token.ts` (`generateShareToken`, `hashShareToken` = SHA-256 hex via Web Crypto, `looksLikeShareToken` = exact shape check). Only the hash is stored (`unique`). The token is returned once by `createShareLink` and never logged, never returned by a list.
- **Lookup.** The public server function first runs `looksLikeShareToken` (a request that fails it is a 404 without touching the database), hashes, selects the link and snapshot by `token_hash`, then compares the stored hash with the computed one using `crypto.subtle.timingSafeEqual` (Workers) as defence in depth. Honest note: the indexed equality lookup on the hash is the real gate and reveals nothing exploitable (the attacker would need a preimage); the constant-time compare is belt and braces.
- **States.** Unknown or malformed: **404**, generic page. Revoked: **410** "This report link has been turned off", expired: **410** "This report link has expired", both with only the agency's name (read from the snapshot's `branding.agencyName`) and "Ask <agency> for a new link". No client, site or finding data on those pages. An older version of a report shows its content with a banner "A newer version was published on <date>." A link whose snapshot belongs to an audit of a deleted organization does not exist (cascade) and is a 404.
- **Exposure.** The public function takes only a token. It returns the model, the version, the publication date, a signed logo URL and `supersededAt`; never an org, audit, user or link id. Evidence is the digest minimiser's output (above). The route is `/r/$token`, outside `/app`, with no session, no app chrome, no command palette, no theme menu and no navigation.
- **Headers** on every response under `/r/` (all statuses), applied in one place that wraps the TanStack handler in `server.ts` (`withReportHeaders`, `server/report-headers.ts`), and `Cache-Control: no-store` also set by the server function for the data request: `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow, noarchive`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'`. The `'unsafe-inline'` scripts are Start's hydration payload; the page renders only React-escaped text, no HTML from data. The page also carries `<meta name="robots" content="noindex, nofollow, noarchive">` and `robots.txt` disallows `/r/`. The logo comes from the same origin (`/files/`), so nothing third-party loads and the token in the URL cannot leak through a Referer.
- **Enumeration and abuse.** 256-bit tokens are not guessable. Failures are uniform (404, same body), the shape check keeps junk off the database, and the view counter writes at most once a minute per link. A Cloudflare rate-limiting rule on `/r/*` is the deploy-side control; adding the Rate Limiting binding to `infra/alchemy.run.ts` is unverified and is a spike (open question 5), not part of this plan's code.
- **Revocation** is immediate: the next request reads `revoked_at`. Nothing caches the page (`no-store`).
- **Management.** Create, list and revoke are server functions behind `requireSession`, `membership` and `auditInOrg` / `shareInOrg`; a link or snapshot id of another organization is a 404. Revoking twice is a no-op. Listing shows label, created by, created, expires, status (Active, Expired, Revoked), opened n times and last opened, and never the token.
- **Consultant text** is rendered as plain text (`whitespace-pre-line`), never HTML or markdown, and never auto-linked.
- **Logo upload** (Task 3). The server reads the first bytes: PNG (`89 50 4E 47 0D 0A 1A 0A`), JPEG (`FF D8 FF`) or WebP (`RIFF....WEBP`). Anything else is rejected, including SVG (scripts) and GIF. The stored `logoType` is the sniffed type; the browser-supplied `Content-Type` and file name are ignored. At most 512 KB, enforced on the server before `Storage.put`. The key is `branding/<orgId>/<crypto.randomUUID()>`, generated on the server; replacing or removing a logo deletes the old object after the row is updated. Files are served by the existing `/files/` route with `downloadHeaders` (inline only for raster, `nosniff`, `default-src 'none'; sandbox`). The page uses a 24-hour signed URL created at render time. Residual risks stated in the settings page and docs: a JPEG may carry EXIF (including location), which we do not strip, and the logo is visible to anyone who has a report link.
- **CSV.** Cells that start with `=`, `+`, `-`, `@`, tab or carriage return are prefixed with a single quote; fields are quoted per RFC 4180; the file starts with a UTF-8 BOM so Excel reads it; `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`; the route resolves the session with `Auth.sessionFromHeaders`, `activeMembership` and `auditInOrg` in that order and answers 404 for anything else.

## Performance targets (168 runs)

The supported maximum is the M4 one (168 runs = (20 pages + 1 journey) x 4 scenarios x 2 viewports), seeded with `docs/plans/2026-10-27-m4-matrix-overview-llm/seed-max.sql` plus 19 findings with check results and a handful of real captures for the evidence step. Local Postgres, warm, p95 of 20 calls, measured on the serialized response. R2 latency is not measured (as in M4); the evidence step reads at most one capture per failing finding.

| Call | Target |
|---|---|
| `getReportDraft` / `buildReport` (all queries, 19 evidence reads, headlines, plan) | <= 1500 ms, <= 150 KB JSON |
| `publishReport` (build, hash, snapshot, logo copy, link, one transaction for the rows) | <= 2500 ms |
| `getSharedReport` (one indexed row, one `exists`, one throttled update) | <= 150 ms, <= 150 KB; first byte of `/r/<token>` <= 400 ms |
| Register CSV (findings plus page paths of their runs) | <= 800 ms |
| Print | the full report at 19 failing findings is at most 30 A4 pages; the summary is exactly one |

If a target is missed the fix is a narrower query or an index, not a stored copy of the draft.

## UX: how a consultant gets there and understands it

- **Entry point.** A sixth audit tab, **Report**, after Hits (`/app/audits/$auditId/report`), shown for every audit (disabled content with an `EmptyState` when the audit is running or Not evaluated: "Available when the audit has check results"). The audit header gets a primary **Share report** button next to the status (visible from every tab once the audit is evaluated); it opens the Report tab with the share dialog (`?share=1`). The command palette gets "Open report" for the audit being viewed only if the palette already knows the current audit (otherwise nothing is added). The completion toast stays "Overview"; the Overview gets one muted line "Ready to send? Open the report" linking to the tab.
- **The Report tab.** A sticky toolbar: a **Consultant view / Client view** segmented control (preview-as-client), a status chip ("Draft, not shared", "Unpublished changes since version 2", "Version 2 shared"), **Share** (opens the dialog), **Save as PDF** (`window.print()`, with the help line about headers and footers), **Export CSV**, and "Branding" (link to Settings > Branding for managers, text for members). Below it the document on a bordered paper surface at a readable width (`max-w-[210mm]`, centred), the exact component the public page renders. In consultant view each section shows small actions: "Edit summary", per finding "Add note", "Leave out of the detail" (toggle), "Change owner" (menu). Edits save on a button with a toast; the draft reloads.
- **Share dialog.** Label, expiry (7, 30, 90 days, Never; default 30), a one-sentence explanation ("Anyone with the link can read this version of the report without signing in. You can turn the link off at any time."), **Create link**. The result shows the full link once in a read-only field with Copy, and "This link is shown once. Create another to send it again." Below, the table of existing links with status, opened counts and **Turn off** (a `ConfirmDialog`), and a row "Version 2, published <date>, by <name>" per snapshot with its links grouped under it. If nothing changed since the latest snapshot, "Create link" offers to reuse that version; otherwise it publishes a new version first and says so ("This publishes version 3 of the report").
- **First time.** On first visit per browser a dismissible card (stored in `localStorage` like the first-run checklist) with three steps: 1 Check the preview and add your branding (link), 2 Edit the summary and notes, 3 Share a link or save a PDF; and "Clients see only the report, never your workspace." Managers whose organization has no logo and no custom agency name see a neutral `Alert` "Your report shows <organization name> without a logo. Add your branding." linking to Settings > Branding; members see "Ask an owner or admin to add the agency's branding."
- **Triage and the report.** The Accept risk dialog gets one line: "The reason is printed in client reports." The Findings tab gets "Export CSV" in its filter row.
- **What a client sees** at `/r/<token>`: only the document, a thin header with the agency logo and name, "Print or save as PDF", and the footer. A revoked or expired link shows the short page described above.
- **Settings > Branding** (managers edit, members read): agency name, logo (upload, preview, remove), accent (eight swatches that show a glyph and a word, with the contrast result in text), footer text, "Show Powered by Zinko" checkbox (on by default), and a live cover preview.

## Tasks

Demo data for browser checks (re-run if the M3/M4 demo audits are absent, with `blockVendorRequests` on, desktop and mobile, scenarios none, accept, reject, gpc, click IDs on, journey on): (A) `clean`; (B) `meta-before-consent`; (C) `duplicate-purchase`; (D) `no-cmp`; (E) `redirect-gclid` (journey); (F) `consent-default-late`; (G) `pii-in-url`; (H) `multiple-ga4`; (X) the 168-run synthetic audit from `seed-max.sql`. Accounts: an owner of organization one, a plain member of it, and an owner of a second organization (for the 404 checks). **Write the expected numbers from `packages/fixtures/README.md` and SQL before building each screen, then compare**, as in M4.

### Task 1: Owner hint as stored rule metadata

**Model:** Sonnet
**Files:** modify `packages/rules/src/types.ts` (`Rule.owner`), every rule file under `packages/rules/src/rules/*/` (one line each), `packages/db/src/rules-schema.ts` (`owner` on `check_result` and `finding`, nullable; generated migration), `apps/web/src/workflows/Audit.ts` (`persist` writes `owner: rule.owner`; `StoredCheck` and `finish`'s select carry it; `findingsFrom` takes it from the newest version's rows, first non-null), `apps/web/src/server/findings-data.ts` and `findings.ts` (return `owner` on the finding), `docs/vision.md`
**Interfaces:** `type OwnerId = "consent-platform" | "tag-manager" | "developer"`, exported from `@repo/rules` with `OWNER_LABELS` (Consent platform admin, Tag manager or marketing, Site developer). Assignment, to be reviewed in the PR: `consent.cookies-without-consent` consent-platform; `consent.pixel-without-consent`, `consent.pixel-after-reject`, `consent.google-without-denied-state`, `consent.default-after-tag`, `clickids.cookie-missing`, `coverage.no-page-view`, `duplicates.multiple-ga4-ids`, `duplicates.meta-loaded-twice`, `hygiene.tag-errors`, `hygiene.location-mismatch` tag-manager; `clickids.lost-on-redirect`, `clickids.lost-across-navigation`, `coverage.purchase-missing-fields`, `coverage.invalid-currency`, `duplicates.purchase-sent-twice`, `dedup.meta-eventid-missing`, `dedup.meta-eventid-reused`, `hygiene.pii-in-hits` developer. `RULES_VERSION` does not change (no verdict changes).
**Blocked by:** none

- [ ] Verify by: `pnpm --filter @repo/db db:generate`, `pnpm db:migrate`; start an audit of (B) `meta-before-consent`; `psql -c "select rule_id, owner from finding where audit_id = '<id>'"` shows the owners above and `select count(*) from check_result where owner is null and run_id in (select id from run where audit_id='<id>')` is 0; an audit from before the migration still opens (Findings, Overview) and its rows are null; `RULES_VERSION` is still `"3"`; the Findings screen is unchanged; `zinko capture <fixture> --rules --json` still runs and prints what it printed before (the CLI does not show owners)
- [ ] Docs: `docs/vision.md` (Rules and findings row: "owner hint"), `AGENTS.md` (Rules: a rule declares its `owner`; it is stored like the other wording); `pnpm check && pnpm typecheck && pnpm build`

### Task 2: Branding settings (name, accent, footer, Powered by)

**Model:** Sonnet
**Files:** create `packages/db/src/report-schema.ts` (`org_branding` only in this task; generated migration), `apps/web/src/lib/report-accent.ts` (`ACCENTS`: eight ids with label and the two colours as `oklch`, no UI import), `apps/web/src/server/branding-data.ts` (`BRANDING_DEFAULTS`, `brandingOf(orgId)` which falls back to the organization's name), `apps/web/src/server/branding.ts` (`getBranding`, `saveBranding`), `apps/web/src/routes/app/settings/branding.tsx`; modify `packages/db/src/index.ts`, `apps/web/src/routes/app/settings.tsx` (tab "Branding"), `apps/web/src/styles.css` (`:root, .report-paper { ...light tokens }` and `.report-paper[data-accent="<id>"] { --report-accent: ...; --report-accent-foreground: ... }` for the eight presets), `AGENTS.md`, `docs/vision.md`, `docs/ui.md`
**Interfaces:** `getBranding -> { branding, canManage }` (any member reads), `saveBranding({ agencyName, accent, footerText, showPoweredBy })` (owner/admin, `Forbidden` otherwise; name 1 to 80 characters trimmed, footer at most 300, accent must be an `AccentId`; `Schema` at the boundary). The form shows a warning (not an error) when text changes under `scrubPersonalData`. The accent swatches show a check glyph and the preset's name, not colour alone
**Blocked by:** none

- [ ] Before building, compute the contrast of every preset against white and of white against it with a throwaway script in `$TMPDIR` (WCAG relative luminance); every ratio is at least 4.5 in both directions; paste the table. Presets that fail are darkened until they pass
- [ ] Verify by, in the browser: a fresh organization shows its own name as the agency name, accent violet, no footer, Powered by on; as the owner, save a name, a different accent and a footer and reload (values persist, `psql` shows one `org_branding` row); the name is rejected at 0 and at 81 characters; as a plain member the form is read-only and a direct `fetch` to the `saveBranding` server function answers `Forbidden` and writes nothing; a second organization's branding is never read; the page at 390px with no horizontal scroll, light and dark; grayscale shows the selected swatch by its glyph and word
- [ ] Docs, then `pnpm check && pnpm typecheck && pnpm build`

### Task 3: Logo upload

**Model:** Opus
**Files:** create `apps/web/src/server/branding-logo.ts` (`uploadLogo`, `removeLogo`), `packages/core/src/image-type.ts` (pure `sniffImageType(bytes) -> "image/png" | "image/jpeg" | "image/webp" | null`); modify `apps/web/src/server/branding.ts` (`getBranding` returns a 24-hour signed `logoUrl`), `apps/web/src/routes/app/settings/branding.tsx` (file input, preview, Remove), `AGENTS.md` (a "Report and branding" section: the logo rules), `docs/vision.md`
**Interfaces:** `uploadLogo` takes `FormData` with one `file` field. **Spike first:** confirm a TanStack Start server function receives `FormData` under `pnpm dev` (workerd) and that a 512 KB body passes; if it does not, send the bytes as a base64 string in JSON (+33%, still under the limit) and say so in the PR. The server rejects anything over 512 KB (`Invalid`) before reading it fully when the length is known, sniffs the bytes, stores `logo_type` from the sniffed type, writes `branding/<orgId>/<uuid>`, updates the row, then deletes the previous object
**Blocked by:** 2

- [ ] Verify by: upload a PNG, a JPEG and a WebP (each appears in the preview and in `psql` with the right `logo_type`; the R2/dev bucket has the object); upload `evil.svg`, a `.png` file that is really a text file, a `.gif`, a 600 KB PNG and an empty file: each is rejected with a plain message and nothing is stored or changed; a PNG renamed to `.jpg` is stored as `image/png`; replace the logo and the old object is gone; Remove deletes the object and clears the row; as a member a direct `fetch` of `uploadLogo` answers `Forbidden`; `curl -sI '<logo url>'` shows `content-disposition: inline`, `x-content-type-options: nosniff` and the sandbox CSP; the URL expires (change the clock or the expiry in a scratch call) and then answers 403
- [ ] Docs, then `pnpm check && pnpm typecheck && pnpm build`

### Task 4: Report tab, `ReportModel` and the cover and summary

**Model:** Opus
**Files:** create `apps/web/src/lib/report-model.ts` (Schemas, `REPORT_MODEL_VERSION`, `headlinesOf`, `reportDate`, `contentHashOf`), `apps/web/src/server/report-data.ts` (`buildReport`, first version: branding, cover, summary, counts, coverage, worst; the other sections empty arrays that Tasks 5 to 7 fill), `apps/web/src/server/report.ts` (`getReportDraft`), `apps/web/src/components/report/{report-view,cover,summary}.tsx`, `apps/web/src/components/score-arithmetic.tsx` (extracted from the Overview's "How this is scored" popover so the report prints the same lines; the Overview uses it too, no behaviour change), `apps/web/src/routes/app/audits/$auditId.report.tsx`; modify `apps/web/src/routes/app/audits/$auditId.tsx` (tab "Report"), `apps/web/src/routes/app/audits/$auditId.overview.tsx`, `apps/web/src/styles.css` (`.report-paper` layout), `pnpm --filter web routes`, `docs/vision.md`, `docs/ui.md`
**Interfaces:** `ReportModel` as above; `getReportDraft({ auditId }) -> { model, contentHash, canManageBranding }` behind `requireSession`, `membership`, `auditInOrg`; `ReportView({ model, mode, logoUrl })`; a not-evaluated or running audit returns `{ available: false, reason }` and the tab shows an `EmptyState`
**Blocked by:** 2, 3

- [ ] Before building, write the expected cover, score, band, counts and headlines for (A), (B), (C) and (H) from `packages/fixtures/README.md`
- [ ] Verify by, in the browser at 1440 and 390, light and dark: the Report tab on (B) shows the agency name and logo from Branding, client and site names, the audited date in the `28 October 2026 (UTC)` form, the scope; the score matches the Overview for the same audit (same number, band, lines; "Critical issues", at most 79, the cap line); headlines are one sentence each, at most four plus the coverage line, and name the same findings the Findings tab lists; (A) says "No failing checks" with "Unresolved checks: 1 rule" and never "clean"; (H) reads "Minor issues only"; a running audit and an M2-era audit show the empty state; another organization's audit id is a 404; the Overview popover still prints the same lines after the extraction; the paper surface stays light in the dark theme; the summary fits one A4 page (checked in Task 8 and re-checked here with the browser's print preview)
- [ ] Docs, then `pnpm check && pnpm typecheck && pnpm build`

### Task 5: Scope and method, and the consent-scenario summary

**Model:** Sonnet
**Files:** modify `apps/web/src/server/report-data.ts` (`method`, `cover.scope`, `consent` with the grouped query), create `apps/web/src/components/report/{scope,consent-summary}.tsx`, modify `report-view.tsx`, `docs/vision.md`, `docs/ui.md`
**Interfaces:** the `consent` and `method` parts of `ReportModel`; the cell words and glyphs are the Tag matrix's (None seen, Not captured, a glyph per state, `StatusGlyph`); no new status vocabulary
**Blocked by:** 4

- [ ] Verify by: for (B) the vendor by scenario table lists Meta and the Google vendors; compare each cell with SQL (`select r.scenario, h.vendor, count(distinct r.id), count(*), count(*) filter (where h.after_consent_action) from hit h join run r on r.id = h.run_id where r.audit_id = '<id>' group by 1, 2`) and with the Tag matrix for the same audit (Meta under reject shows hits after the choice); (D) `no-cmp` shows "Not captured" for the partial runs and never "None seen" over them; an audit with one scenario shows one column; a screenshot in grayscale still tells Fired, None seen and Not captured apart; the method section prints the rules versions and, on a mixed-version audit (edit one `check_result.rules_version` in the scratch database), the mixed-versions label; both fixed sentences ("No model decides", "not legal advice") are present
- [ ] Docs, then `pnpm check && pnpm typecheck && pnpm build`

### Task 6: Findings with stored wording and one safe evidence item

**Model:** Opus
**Files:** create `apps/web/src/server/digest-data.ts` (the `digestOf` assembly moved out of `explain.ts`, unchanged in behaviour), modify `apps/web/src/server/explain.ts` (imports it), `apps/web/src/server/report-data.ts` (`findings`, `leftOut` empty until Task 9), create `apps/web/src/components/report/findings.tsx`, modify `report-view.tsx`, `apps/web/src/components/finding-detail.tsx` (Accept risk dialog line: "The reason is printed in client reports."), `docs/vision.md`, `docs/ui.md`
**Interfaces:** `digestOf` exported with the same arguments as before; `ReportFinding.evidence` built from `buildDigest(finding, [oneRun], { includePagePaths: true })`; the evidence caption names the page path (no query), scenario and viewport; the evidence table has the columns Vendor, Event, Destination, Timing, Consent state, and shows at most `MAX_EVIDENCE` rows
**Blocked by:** 1, 4

- [ ] Verify by: the Explain button still works on (B) against the stub (the extraction changed nothing: same cache row, `evidence_hash` identical to the one stored before); the Report's findings for (B), (F) and (G) show the stored `title`, `why` and `fix` steps exactly as `psql` returns them; rename a rule's title in a scratch edit of `packages/rules` and rebuild: an existing audit's report still shows the stored title (wording is stored, not live); the evidence for (G) `pii-in-url` contains no query string, email, phone number or parameter value: `curl` the server function's JSON (or copy the model from the network tab) and grep it for `@`, `?`, `=`, `ZINKO-TEST`, `gclid` and the fixture's address; accepted risk shows its reason, Fixed shows "marked fixed by the author, not re-verified", the banner note appears on a no-banner audit's consent finding; an audit with a finding whose evidence cannot be built shows the card without an evidence table, not an error
- [ ] Docs, then `pnpm check && pnpm typecheck && pnpm build`

### Task 7: Action plan by owner and the appendix

**Model:** Sonnet
**Files:** modify `apps/web/src/lib/report-model.ts` (`actionPlanOf`), `apps/web/src/server/report-data.ts` (`actionPlan`, `appendix`), create `apps/web/src/components/report/{action-plan,appendix}.tsx`, modify `report-view.tsx`, `docs/vision.md`, `docs/ui.md`
**Interfaces:** the `actionPlan` and `appendix` parts; groups in the order consent platform, tag manager, developer, "Owner not assigned"; the rules list is built from the audit's `check_result` rows (stored title, area, severity, version)
**Blocked by:** 1, 6

- [ ] Verify by: (B) and (F) put their open failing findings under the owner named in Task 1; triage one finding as accepted risk and another as fixed: both leave the plan and appear under "Not in the plan" with their state; an audit from before Task 1 shows its findings under "Owner not assigned" last; the appendix's Could not check list for (A) names `hygiene.tag-errors` with its reason and never presents it as a pass; Not evaluated lists the failed runs of (D) with their failure codes; the rules list counts add up to the number of runs per rule (`select rule_id, status, count(*) from check_result ... group by 1, 2`); delete nothing from the registry but compare: the rules list of a pre-existing audit is identical before and after adding a new rule to `@repo/rules` (stored, not live)
- [ ] Docs, then `pnpm check && pnpm typecheck && pnpm build`

### Task 8: Print stylesheet and Save as PDF

**Model:** Opus
**Files:** modify `apps/web/src/styles.css` (`@media print`, `@page`), `apps/web/src/components/report/*` (print classes), `apps/web/src/routes/app.tsx` and the shell components (`print:hidden` on the sidebar, top bar and tabs), `apps/web/src/routes/app/audits/$auditId.report.tsx` (toolbar button "Save as PDF" with the headers-and-footers help line), `docs/vision.md` (PDF row: print now, engine PDF deferred with the five prerequisites), `docs/ui.md`
**Interfaces:** `@page { size: A4; margin: 16mm 14mm }`; each top-level section starts a page (`break-before: page`) except the first appendix lettered parts; finding cards, table rows and the evidence table use `break-inside: avoid`; `print-color-adjust: exact` only for the accent band and glyph fills; tables lose their scroll container; running footer through `@page { @bottom-center { content: ... } }` where supported
**Blocked by:** 4, 5, 6, 7

- [ ] Verify by, with a throwaway script in `$TMPDIR` (not committed) that imports `chromium` from `apps/browser/node_modules/playwright`, opens the Report tab with a signed-in storage state (or, after Task 11, the public URL), calls `page.emulateMedia({ media: "print" })` and `page.pdf({ format: "A4", preferCSSPageSize: true })`: (B) produces a PDF whose first page is the cover, whose second page holds the whole summary (count pages with `pdfinfo` if installed, otherwise by counting `/Type /Page` objects), whose text (`pdftotext` or the script's own extraction) contains no `Sidebar`, `Settings`, "Edit summary" or "Add note"; no finding card is cut across two pages (look at the page images); convert pages to grayscale and confirm severity, Fail and None seen are still told apart; the 19-finding synthetic audit (X) stays within 30 pages; Firefox print preview (through the Playwright MCP browser or by hand) shows the same structure; the in-app Save as PDF button opens the print dialog and the printed result has no app chrome
- [ ] Docs, then `pnpm check && pnpm typecheck && pnpm build`

### Task 9: Consultant edits: summary, notes, hide, owner

**Model:** Opus
**Files:** modify `packages/db/src/report-schema.ts` (`report_edit`, `report_finding_edit`; generated migration), create `apps/web/src/server/report-edit.ts` (`saveReportEdit`, `saveFindingEdit`), modify `apps/web/src/server/report-data.ts` (apply edits: summary source, notes, `leftOut`, owner override, `ownerSource`), `apps/web/src/lib/report-model.ts`, `apps/web/src/components/report/*` (consultant-mode controls: an "Edit summary" sheet, per finding "Add note", "Leave out of the detail" toggle, "Change owner" menu; left-out findings dimmed with a "Left out" chip in consultant mode), `AGENTS.md` (the edits are people's work: the workflow never touches them; the report never reads them from the registry), `docs/vision.md`, `docs/ui.md`
**Interfaces:** `saveReportEdit({ auditId, summary })` (null or empty clears; at most 2000 characters), `saveFindingEdit({ auditId, ruleId, note?, hidden?, owner? })` (note at most 1000; `owner` an `OwnerId` or null to clear; the rule must exist as a finding of that audit, else 404). Any member. Both check `auditInOrg` first. The editors show the personal-data warning. A controlled `Sheet` opened from a button restores focus in `onCloseAutoFocus`
**Blocked by:** 6, 7

- [ ] Verify by: edit the summary (Client view shows the author's text above the generated headlines, labelled "Generated from the findings"); clear it and the generated summary returns; add a note and see it under the finding in Client view; leave a finding out: it disappears from the findings and the action plan, the score and its arithmetic are unchanged and still list it, the appendix lists it under "Left out of the detail by the author", the Overview and Findings tabs still list it; change an owner and see the action plan move it (and "Owner not assigned" fall away); `psql` shows rows only in `report_edit` and `report_finding_edit` and none in `finding` or `finding_triage`; re-run the audit's `finish` step by starting a new audit on the same site and confirm the edits of the first audit are untouched; the second organization's owner calling `saveFindingEdit` with the first organization's audit id gets a 404 and writes nothing; a text containing an email address shows the warning and still saves; markup typed in a note (`<img src=x onerror=alert(1)>`) is shown literally in both views; the sheet restores focus to its button; 390px
- [ ] Docs, then `pnpm check && pnpm typecheck && pnpm build`

### Task 10: Snapshots and share links (management side)

**Model:** Opus
**Files:** modify `packages/db/src/report-schema.ts` (`report_snapshot`, `report_share`; generated migration), create `packages/core/src/share-token.ts` (exported from `@repo/core`), `apps/web/src/server/report-share.ts` (`publishReport`, `createShareLink`, `listShares`, `revokeShare`, `shareInOrg`), `apps/web/src/components/report/share-dialog.tsx`; modify `apps/web/src/routes/app/audits/$auditId.report.tsx` (toolbar chip, Share button, the dialog), `apps/web/src/routes/app/audits/$auditId.tsx` (header "Share report" button, `?share=1`), `AGENTS.md` (snapshots are frozen and not derived rows; only the token hash is stored; management goes through `shareInOrg`), `docs/vision.md`, `docs/ui.md`
**Interfaces:** `createShareLink({ auditId, label?, expiresInDays: 7 | 30 | 90 | null })` publishes a new snapshot when `contentHash` differs from the latest snapshot's (version assigned under a row lock on the audit, so two simultaneous publishes get versions n and n+1), copies the logo, validates the model with the `ReportModel` Schema, inserts the link and returns `{ token, url }` **once**; `listShares({ auditId })` returns snapshots with their links (no token, no hash), the unpublished-changes flag and who published; `revokeShare({ shareId })` sets `revoked_at` and `revoked_by` (idempotent). Any member. The URL is built from the request origin, never from user input
**Blocked by:** 9

- [ ] Verify by: create a link on (B) with label and 30 days: the dialog shows the full URL once; `psql` shows one `report_snapshot` (version 1, `model` valid, `logo_key` under `reports/<id>/logo`, the object exists), one `report_share` whose `token_hash` is 64 hex characters, and no column anywhere holds the token (`grep` the dump: `pg_dump -t report_share -t report_snapshot | grep -c '<the token>'` is 0); create a second link without changes: version stays 1, two links; edit a note: the chip says "Unpublished changes", the next link publishes version 2 and says so; two parallel `createShareLink` calls (`curl` twice at once) get distinct versions; revoke a link and see its status; revoke twice is fine; the second organization's owner calling `revokeShare` or `listShares` with the first organization's ids gets a 404; replace the logo in Branding afterwards and confirm snapshot 1's `logo_key` object is untouched; a member (not manager) can create and revoke; the dialog and table at 390px, focus returns to the Share button on close
- [ ] Docs, then `pnpm check && pnpm typecheck && pnpm build`

### Task 11: The public report page

**Model:** Opus
**Files:** create `apps/web/src/routes/r.$token.tsx` (no `/app` parent, no shell; its own minimal layout, light, `head` with `robots` meta), `apps/web/src/server/shared-report.ts` (`getSharedReport`, no session middleware), `apps/web/src/server/report-headers.ts` (`withReportHeaders`), `apps/web/public/robots.txt` (create or extend: `Disallow: /r/`), modify `apps/web/src/server.ts` (wrap the TanStack handler result for paths under `/r/` and for the report server function), `apps/web/src/components/report/report-view.tsx` (public header, unavailable pages), `AGENTS.md` (the public route rules), `docs/ui.md` ("Revoked share link" state replaced by what was built), `docs/vision.md`; `pnpm --filter web routes`
**Interfaces:** `getSharedReport({ token }) -> { state: "ok", model, version, publishedAt, supersededAt, logoUrl } | { state: "off", reason: "revoked" | "expired", agencyName }`; a malformed or unknown token is a `notFound()`. The function returns no internal id. Status codes: 200, 410 for off, 404; headers exactly those in "Share link: security design"
**Blocked by:** 10

- [ ] Verify by, with `curl -is` and the browser: an active link returns 200 with the report, signed out and in a private window; the response has every header listed (paste them), `<meta name="robots">` is in the HTML, and the HTML contains no sidebar, no theme menu and no script or link to a third-party host (`grep -o 'https\?://[^"]*'` shows only same-origin); the token is not in any response body; a one-character-changed token, a 42-character token, a path-traversal string and an empty token each return an identical 404 (compare bodies with `diff`) and cause no database query for the malformed ones (check with `log_statement = all` or `pg_stat_statements`); revoke the link and reload: 410 "turned off" with the agency name and no report data; set `expires_at` in the past in `psql`: 410 "expired"; create version 2 and open version 1's link: the content of version 1 shows with "A newer version was published on <date>"; edit triage after publishing and confirm the shared page does not change; the view counter increments once for two requests within a minute; the shared page prints (Task 8's script against the public URL); timings: 20 requests, p95 <= 150 ms for the data call; the audit id, organization id and user ids are not in the HTML or the JSON (`grep` for them)
- [ ] Docs, then `pnpm check && pnpm typecheck && pnpm build`

### Task 12: CSV audit register

**Model:** Sonnet
**Files:** create `apps/web/src/server/register-route.ts` (a `WorkerRoute` for `GET /api/audits/<auditId>/register.csv`), `apps/web/src/lib/csv.ts` (RFC 4180 quoting, formula-injection prefix, BOM), `apps/web/src/server/register-data.ts` (rows from `findingsOf`, run pages, edits); modify `apps/web/src/server/routes.ts` (register the route), `apps/web/src/routes/app/audits/$auditId.findings.tsx` and the Report toolbar ("Export CSV"), `AGENTS.md`, `docs/vision.md`, `docs/ui.md`
**Interfaces:** one row per finding, failing first by severity, then Could not check. Columns: Site, Audit date, Rule ID, Finding, Severity (blank for Could not check), Area, Status (Fail or Could not check), Owner (the effective owner label), Failing runs, Runs checked, Pages (count), Page paths (without query, `; `-separated, at most 20 then "+n more"), Scenarios, Triage (Open, Accepted risk, Fixed), Accepted-risk reason, Note, In report (Yes or Left out), Rules version, Why it matters, Fix steps (` | `-separated). Live rows, consultant only. Session resolution in the order of `audit-room-route.ts`: `Auth.sessionFromHeaders`, `activeMembership`, `auditInOrg`; any failure is a 404. The file name is `zinko-register-<host>-<yyyy-mm-dd>.csv` with the host sanitised
**Blocked by:** 9

- [ ] Verify by: download from the Report toolbar and from Findings: the file opens in a spreadsheet (LibreOffice or `python -c "import csv"` reading it back) with the right columns and one row per finding of (B) matching the Findings tab; a note, a hidden finding, an accepted risk with a reason and an owner override all show; put `=HYPERLINK("http://x","y")` in a note and see it stored as `'=HYPERLINK(...)` and shown as text in the spreadsheet; a note containing a comma, a quote and a newline round-trips; a signed-out `curl` gets 404; the second organization's session gets 404 for the first organization's audit; response headers include `content-disposition: attachment`, `x-content-type-options: nosniff`, `cache-control: private, no-store`; no query string or parameter value appears in the file (`grep '?' register.csv` finds none)
- [ ] Docs, then `pnpm check && pnpm typecheck && pnpm build`

### Task 13: Getting there: header action, first-run help, branding nudge

**Model:** Sonnet
**Files:** modify `apps/web/src/routes/app/audits/$auditId.tsx` (the Share report button if not already complete), `apps/web/src/routes/app/audits/$auditId.overview.tsx` (the "Ready to send?" line), `apps/web/src/routes/app/audits/$auditId.report.tsx` (the first-run card, the branding `Alert`, the view toggle's URL state `?view=`), `apps/web/src/components/command-palette.tsx` only if it already has the current audit, `docs/ui.md` (Navigation tree gains Report and Settings gains Branding; "Not built yet" loses the report), `docs/vision.md`
**Interfaces:** `localStorage` key `zinko:report-intro-dismissed`; nothing server-side. No new component libraries
**Blocked by:** 11, 12

- [ ] Verify by, as a new user in a fresh organization on a finished audit: the Overview points to the Report; the Report tab shows the three-step card and the branding `Alert` (owner: link to Settings > Branding; member: "Ask an owner or admin"); dismissing the card persists across reload and does not return in the same browser; after saving a logo and a name the `Alert` is gone; the Consultant/Client toggle is in the URL and survives reload; keyboard-only: tab order reaches Share, Save as PDF, Export CSV, the toggle, each finding's actions; every control is 32px or more and shows `ring-ring/50`; 390px has no horizontal page scroll and the toolbar wraps; grayscale
- [ ] Docs, then `pnpm check && pnpm typecheck && pnpm build`

### Task 14: Performance and security sweep at the supported maximum

**Model:** Opus
**Files:** none committed unless a target is missed: an index or a narrower query in `report-data.ts`; a throwaway timing script in `$TMPDIR`; `docs/vision.md` (measured numbers)
**Interfaces:** the targets in "Performance targets". The seeded audit (X) is `seed-max.sql` plus 19 findings with check results whose rules exist, and captures for at least ten failing runs so the evidence step reads real files
**Blocked by:** 11, 12

- [ ] Verify by: seed (X), report row counts; time `getReportDraft`, `createShareLink` (publish), `getSharedReport`, the first byte of `/r/<token>` and the CSV, 20 calls each, p50 and p95 and the serialized size; run `EXPLAIN (ANALYZE, BUFFERS)` on the consent-summary query and the appendix rules query and paste the plans; open the Report on (X) at 390px and report responsiveness; print it with Task 8's script and report the page count and the summary page count. If a target is missed, narrow the query or add an index (generated migration) and re-measure
- [ ] Security pass, each with the command and the result: token entropy (generate 10,000 tokens in a scratch script, all unique, all match `looksLikeShareToken`); `psql` and `pg_dump` contain no token; the server logs of the whole session (`grep -r zr1_` over the dev server output and `$TMPDIR` logs) contain no token except the one printed by the dialog's copy action in the browser; headers on 200, 404 and 410; a report page loaded with network blocked except the origin still renders (no third-party dependency); upload and CSV checks of Tasks 3 and 12 repeated against the final build; an attempt to read `/files/<snapshot logo key>` without a signature answers 403
- [ ] `pnpm check && pnpm typecheck && pnpm build`

### Task 15: Sweep, docs and the demo

**Model:** Sonnet
**Files:** modify `docs/roadmap.md` (M5 row done locally with the date; "Left over from M4" items this milestone resolved or moved: finding markers in matrix cells stay deferred), `docs/vision.md` (a final read of "Report (M5)", the "M5 demo", the measured numbers, what is deferred), `docs/ui.md`, `docs/product.md` only where behaviour differs, `AGENTS.md` (read once for consistency), this plan (`status: implemented` and an execution status paragraph)
**Blocked by:** 1 to 14

- [ ] Sweep at 390x844 and 1440x900, both themes, grayscale, on (A) to (H) and (X): Settings > Branding, the Report tab in both views, the share dialog, the public page, the revoked page, the print preview; no horizontal page scroll (tables scroll inside their container), 32px targets, focus rings, no hard-coded colours (`rg "#[0-9a-fA-F]{3,8}"` over the new routes and `components/report/` finds none; the accent presets live in `styles.css` and `report-accent.ts` only), no inline `style`, vocabulary check (`rg -i "inconclusive|healthy|clean"` over the new UI strings finds none outside "No failing checks")
- [ ] The demo end to end on a real client-style site: set branding with a logo, audit, open the Report, edit the summary and one note, leave one finding out, share a 30-day link, open it signed out in a private window on a phone-width viewport, save the PDF from it, export the CSV, turn the link off and see the 410 page. Record the commands and what was seen in `docs/vision.md`; list surprises as new leftovers in `docs/roadmap.md`
- [ ] `pnpm check && pnpm typecheck && pnpm build` exit 0, zero warnings

## Open questions for the product owner

Each with a recommendation; the plan proceeds on the recommendation.

1. **Who may share?** Recommend any member (same trust as triage), with branding manager-only and `created_by` shown. An org switch "only owners and admins can share" is a small later addition if agencies ask.
2. **Default expiry.** Recommend 30 days with "Never" available; regulators and contracts want a dated record, which the snapshot gives regardless of the link's life.
3. **Custom accent hex and client logo.** Recommend neither in M5: presets cannot be unreadable and need no inline style; co-branding is a later request.
4. **Screenshots in the report.** Recommend deferring: they can show personal data, need a per-finding consultant toggle and a copy into the snapshot's storage, and the evidence table already proves the finding.
5. **Rate limiting.** Recommend a Cloudflare rate-limiting rule on `/r/*` at deploy and a spike on the Rate Limiting binding in `infra/alchemy.run.ts`; the tokens are not enumerable, so this is abuse control, not secrecy.
6. **Server-side PDF.** Recommend after v0.1, with the five prerequisites in "PDF: print stylesheet or the capture engine", or Browser Rendering if the container path stays unproven.
7. **AI text in the report.** Recommend an explicit per-finding "Include the AI explanation" toggle in M6, only when cached and the policy is on, labelled "AI-written" in the report; not in M5.
8. **Owner and effort.** Owner ships as three roles; an effort hint (hours) per rule is not shipped because no rule has one measured. Recommend collecting it from the first real reports before adding a field.
9. **Accepted-risk reasons are client-visible.** Recommend showing them (the research wants them), with the warning in the dialog; split "internal reason" from "client-facing wording" only if consultants ask.
10. **Old audits have no owner.** Recommend leaving them "Owner not assigned" with the consultant override rather than a hand-written backfill migration.
11. **Hidden findings stay in the score.** Recommend as decided ("Leave out of the detail"); the alternative, recomputing a report-only score, would make the report disagree with the app.

## Not in this plan

Re-run diff and "fixed / new / unchanged" in the report (M6), a server-rendered PDF, PPTX, Slides or Sheets export, screenshots or raw requests in the report, AI-written text in the report, client accounts or a portal, emailing the link, link analytics beyond opened-count, scheduled or recurring reports, report templates, translations, a custom accent hex, client logos, retention or deletion of snapshots, an effort estimate per finding.

## Task list at a glance

1. Owner hint as stored rule metadata (`check_result.owner`, `finding.owner`).
2. Branding settings: name, accent presets (contrast-checked), footer, Powered by.
3. Logo upload: magic bytes, 512 KB, signed URL.
4. Report tab, `ReportModel`, cover and one-page summary.
5. Scope and method, and the consent-scenario summary.
6. Findings with stored wording and one safe evidence item.
7. Action plan by owner and the appendix.
8. Print stylesheet and Save as PDF.
9. Consultant edits: summary, notes, leave out, owner.
10. Snapshots and share links (create, list, revoke).
11. The public report page (`/r/<token>`, headers, revoked and expired states).
12. CSV audit register.
13. Getting there: header action, first-run help, branding nudge.
14. Performance and security sweep at 168 runs.
15. Sweep, docs and the demo.
