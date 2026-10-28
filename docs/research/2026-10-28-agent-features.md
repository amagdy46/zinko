# AI-agent features: what to build, and where competitors stand (2026-10-28)

Desk research by an agent on 2026-10-28, using web search and page fetches. It builds on `2026-10-28-competitors.md` and `2026-10-28-pain-points.md` and does not repeat their tables.

## Method and caveats

- Searches covered the vendors named in the brief, then I fetched the primary page where one existed (vendor docs, release notes, press releases).
- The search tool is US-only and returned few forum posts. I found no Reddit, MeasureSlack or LinkedIn threads on AI in analytics QA. Section 4 therefore rests on practitioner blogs and vendor posts, and says so. Treat it as thin.
- Vendor pages are marketing. "Shipped" below means the vendor's own docs or release notes describe it. I could not test any product.
- Not verified: Datatrue (no 2026 AI announcement found, which is not proof there is none), Didomi and OneTrust scanners (nothing found), Segment Protocols (Twilio ships no first-party MCP server as of September 2026, per a third-party guide), Google Tag Assistant (no AI feature found).
- Trackingplan's documentation was not reachable through search. The earlier competitor doc lists "an audit agent with OK / Needs attention / Inconclusive verdicts"; I could not re-confirm that name on the homepage.
- Pricing and availability change. Re-check before quoting.

## 1. Competitor table

| Tool | AI features shipped (per vendor) | Evidence |
|---|---|---|
| ObservePoint | Hosted MCP server, "more than 100 tools": build and run Audits, Journeys, Rules, Alerts and Reports in plain language, bulk-edit Rules, HAR analysis. OAuth, scoped to the user's role. Help centre says confirmation is typical before create, delete or full scans. Press release dated 2026-10-08; a help-centre security article still says "not yet generally available", so the status is unclear. The "80% faster onboarding" figure is the vendor's own. | [Press release](https://www.webull.com/news/15713205279802368), [connect guide](https://help.observepoint.com/en/articles/16299323-connecting-to-the-observepoint-mcp-server), [security note](https://help.observepoint.com/en/articles/16313176-observepoint-mcp-server-security-trust) |
| Tag Inspector (InfoTrust) | "AI-enabled CMP scanning" (2026-06-13): a model finds consent UI it has no template for, maps it to accept, reject or granular states, and simulates each. No accuracy rate or failure modes stated. August 2026 release adds per-choice auditing ("only performance", "only strictly necessary") and sGTM support. | [CMP scanning](https://infotrust.com/articles/tag-inspectors-ai-enabled-cmp-scanning-any-site-any-cmp-any-selection/), [release notes](https://infotrust.com/?p=94451) |
| Trackingplan | Homepage markets a "digital analytics agent": plain-English automations that become reports, rules or alerts; answers through Claude, ChatGPT or MCP (an example shows 11 tools); delivery to Slack and Teams. The on-page chat is labelled scripted. Pricing and credits not visible. | [Homepage](https://www.trackingplan.com) |
| Avo | MCP out of beta 2026-06-16. Agents read the plan, draft tracking from a PRD or Figma file onto a branch, generate implementation guides from the branch diff. Every write lands on a branch, never main; same role gates as the UI. In-app agent and review workflows are listed as upcoming. PII classification in beta. | [Avo blog](https://www.avo.app/blog/your-ai-assistant-connected-to-your-tracking-plan), [docs](https://avo.app/docs/reference/avo-mcp/overview) |
| Segment Protocols | No first-party MCP server found. Third-party wrappers exist. | [Third-party guide](https://www.fast.io/resources/mcp-server-for-segment.md) |
| Stape | In-account AI Assistant (beta, Pro plans, 100 messages a month): audits GTM containers, creates, updates, deletes and publishes tags, reverts versions, reviews GA4 and Ads conversion setup. The docs do not say whether it asks before writing. A hosted GTM MCP server also exists. GTM Helper (extension) has no AI. | [AI Assistant docs](https://stape.io/helpdesk/documentation/ai-assistant-overview), [GTM MCP](https://stape.io/blog/mcp-server-for-google-tag-manager) |
| Other GTM MCP servers | Several third-party servers (Stape, gtmeditor, Markifact, community ones) let Claude or Gemini read and edit containers. | [Directory](https://mcp.directory/blog/google-tag-manager-mcp-complete-guide-2026) |
| Google Tag Assistant, Omnibug, dataslayer | No AI features found. | Searches above |
| Datatrue | No 2026 AI feature found. A SoftwareReview listing mentions natural-language querying, unclaimed by the vendor. | [Listing](https://softwarereview.com/s/datatrue) |
| Didomi, Cookiebot, OneTrust | No AI scanner found. | Searches above |
| Small AI-native entrants (Tracking Auditor, GAfix, Alethia, jtracking skill) | Config-side audits through the GTM and GA4 APIs with an LLM writing the report. Alethia and jtracking describe agents and consent-chain checks; claims unverified. None found that drives a browser through a funnel. | [Alethia](https://alethia-website.pages.dev/features), [jtracking](https://jtracking.ai/blog/how-to-audit-ga4-gtm-tracking-and-decide-whether-to-fix-or-rebuild/) |
| Practitioner recipes | Blog posts show Claude plus a GTM or GA4 MCP doing a container or property audit in minutes. | [MeasureU GA4](https://measureu.com/ga4-audit-ai-claude/), [MeasureU GTM](https://measureu.com/gtm-container-audit/), [Markifact](https://www.markifact.com/blog/google-tag-manager-audit-claude) |

### What this says

- **MCP is now table stakes for the paid vendors.** ObservePoint, Trackingplan, Avo and Stape all have one or market one. Zinko has none.
- **Writes are where vendors differ.** Avo restricts writes to branches. Stape's docs describe direct publish with no stated approval step. Zinko should copy Avo.
- **One vendor ships model-driven CMP interaction.** Tag Inspector says it works on unseen banners. Zinko's known limit is CMPs that autoconsent cannot operate (Happy Socks' Cookiebot accept is not applied), so this gap is real and the competitor claim is unproven.
- **Nobody ships agent-driven funnel discovery that I could find.** The gap noted in the competitor doc still holds.
- **Most "AI" is config-side.** Reading a GTM container with an LLM is cheap and crowded. Evidence from a real browser under consent scenarios is not.

## 2. Candidate features

Zinko constraints applied to each: rules stay deterministic; the LLM never decides a verdict; bring your own key; page data may contain personal data; the AI policy defaults to off; spend is metered per organization.

| Feature | User value | Feasibility | Risks | Effort |
|---|---|---|---|---|
| A. MCP server over audits (read-only first) | Consultants already work in Claude or ChatGPT. Ask "what failed on checkout?" against stored, rule-decided data. | High. Findings, check results, compare and evidence resolve behind `auditInOrg` today. A Worker route plus OAuth. The caller's model, not the org's key, does the talking. | Personal data in tool results. Needs the same minimised digest as Explain, org scoping, an entry in the route registry. Prompt injection from page text in results. | M |
| B. Funnel discovery agent that outputs a replayable spec | The biggest manual cost in audits is getting to add-to-cart and checkout. Journey rules need it. | Medium. Agent runs once, emits selectors, Playwright replays with no LLM, a failed step is flagged as drift (already in `vision.md`). The agent never judges hits. | Untrusted page text can steer the agent. Checkout side effects (real orders, form data). Reliability numbers I found are vendor-grade and not checkout-specific (see [one comparison](https://www.skyvern.com/blog/skyvern-mcp-vs-stagehand-compared-ai-browser-automation/)). Bot protection. | L |
| C. Banner interpreter for unknown CMPs | Fixes the stated limit: accept rows "could not check" on CMPs autoconsent cannot drive. Tag Inspector claims the same. | Medium. Model sees the banner DOM, proposes a click selector for accept or reject. The capture then verifies by a consent change in cookies or `gcs`; otherwise the row stays "could not check". The model proposes, an observable fact confirms. | Wrong button clicked (for example "manage" read as reject). Banner text sent to a provider. Needs a rule that a proposal is accepted only after a measured consent change. | M |
| D. Report summary and fix tickets from findings | The summary is the most edited part of a report. Tickets ("Ask for", "Done when") already exist as fields. | High. Explain's policy, ledger and cache cover it. Input is stored, minimised wording, not hits. Consultant edits before it reaches the client. | Hallucinated claims in a client document. Mitigate with a draft-only label, citing finding ids, and a check that every number in the output appears in the input. | S–M |
| E. GTM change drafts (a spec, not a write) | Turns a finding into a concrete GTM edit, as Stape and NiceLookingData do. | Medium. Needs the GTM connector (v0.2). Output is a diff or a text spec for a person to apply. Never publishes. | A wrong tag change is worse than none. Vendors that publish directly carry this risk. | M, after connector |
| F. Natural-language questions over hits | "Did any Meta event fire before consent on checkout?" | Medium. Only safe as a translator from question to a structured filter (vendor, scenario, page, phase) over the hits table, with the filter and counts shown beside the answer. Free-form SQL or free-text answers invite the sampled-rows failure seen with the Google Analytics MCP ([Coupler test](https://blog.coupler.io/how-to-analyse-ga4-with-ai/): wrong year, 1,000-row cap, inverted trend, no warning). | Silent truncation. A wrong answer looks like a verdict. | M |
| G. Rule and fixture drafting for maintainers | Speeds the 28-rule growth, which the AGENTS.md procedure already structures. | High, and mostly a dev workflow (a skill or script), not a product feature. | Drafts must still pass the fixture README before merge. | S |
| H. Automated triage and dedup | Group the same root cause across pages ("same GTM tag, 12 pages"). | Mostly deterministic: group by rule, vendor, destination and initiator. An LLM adds little. | LLM grouping can merge unlike things. | S (non-LLM) |
| I. Autonomous "agent audits the whole site and decides" | Marketing appeal. | Conflicts with the core principle. | Non-repeatable, indefensible to a client or regulator. | Do not build |

## 3. Ranked recommendation

Ranking weighs value for a consultant, fit with the principles, and whether it closes a gap competitors have not.

1. **C. Banner interpreter, verified by observation (v0.2, M).** Closes a documented Zinko limit and matches a competitor claim. The model only proposes a selector. The existing consent-change signal decides whether it worked, so no verdict becomes a guess. Start with a spike on the CMPs that fail today.
2. **A. Read-only MCP server (v0.2, M).** Every serious competitor is moving here, and consultants already use Claude. The data is deterministic, so the caller's model explains but cannot change findings. Ship read tools only: list audits, findings, evidence, compare. Scope by organization, return the minimised digest and never hit URLs or params, as the report does.
3. **D. Draft report summary and ticket text (v0.2, S–M).** Reuses the Explain stack, policy and ledger. Draft only, consultant edits, every figure traceable to a finding. Highest daily time saving per unit of work.
4. **B. Funnel discovery to a replayable spec (v0.2 spike, v0.3 if it holds, L).** Already planned. Keep the split: the agent runs once with a read-only allowlist and no form submission beyond a test card, the spec replays with no LLM. Gate on a spike with a measured success rate on the fixtures and two real shops. If it fails there, drop it rather than ship a flaky default.
5. **F. Question-to-filter over hits (v0.3, M).** Build on the MCP tools: the question becomes a typed query the user can see and edit, and the answer is the rule-engine's rows. Never a prose answer without the filter and the count.
6. **E. GTM change drafts (v0.3, M, needs the v0.2 connector).** Text or diff only. Pair with Avo's pattern: proposals, never publishes.
7. **H. Non-LLM grouping of repeated findings (v0.2–v0.3, S).** Deterministic and cheap. It reduces report noise before any model is involved.
8. **MCP write tools (v0.4).** Only as proposals against the YAML plan, merged by a person (already in `vision.md`). Leave out of earlier versions.

G (rule drafting) belongs in the contributor workflow, not the roadmap.

## 4. What consultants worry about

Evidence is thin; no forum threads were reachable. What exists:

- **Wrong numbers with no warning.** A hands-on test of the Google Analytics MCP found a wrong year, a silent 1,000-row cap and a reversed trend, presented as fact ([Coupler.io](https://blog.coupler.io/how-to-analyse-ga4-with-ai/), vendor with a competing product, preview-era server).
- **Config is not behaviour.** Markifact's Claude guide says the audit must separate what GTM is set up to do from what a browser does, and that a trigger name proves nothing ([Markifact](https://www.markifact.com/blog/google-tag-manager-audit-claude)). OptimizeSmart makes the same point about source code versus network captures ([OptimizeSmart](https://optimizesmart.com/blog/using-claude-for-ga4-gtm-ss-tagging-audit-in-great-detail/)). This favours Zinko's captured hits.
- **The practitioner upside is time.** MeasureU reports a 3–4 hour GA4 audit done in minutes, with the caveats "garbage in, garbage out" and "the AI doesn't know what matters" ([MeasureU](https://measureu.com/ga4-audit-ai-claude/)). The post does not discuss privacy or hallucination.
- **Write access to production.** Security writing on MCP stresses that tools inherit the agent's permissions and that write access raises the stakes ([Mondaq](https://www.mondaq.com/unitedstates/new-technology/1779012/mcp-servers-raise-the-stakes-for-ai-governance)). Read-only and branch-only designs answer this.
- **Browser agents obey page text.** Indirect prompt injection against browsing agents is reported in live attacks in 2026, and OWASP says no fool-proof block is known ([Cloud Security Alliance note](https://labs.cloudsecurityalliance.org/research/csa-research-note-indirect-prompt-injection-in-the-wild-2026/), secondary source). A tracking auditor visits sites it does not control, so this applies to features B and C directly.
- **Privacy.** I found no consultant-written source. The inference from Zinko's own rules: captured pages and hits can hold emails and IDs, and agency clients' contracts may forbid sending them to a model provider. The existing AI policy (off by default, minimised digest, key never stored) is the right base.

## 5. Features to avoid

- **An agent that decides pass or fail** (I). It breaks the repeatable, defensible record that is Zinko's pitch, and regulators now order repeat tracking audits ([pain points](2026-10-28-pain-points.md)).
- **Direct publish to GTM or any write to a client system.** Stape's docs describe it with no stated approval step. One wrong tag change on a live container costs more than any time saved. Propose, never apply.
- **Free-text answers about hits without the underlying filter and counts.** This is the failure mode in the Coupler test.
- **Sending raw hits, URLs, params or banner screenshots to a provider.** Use the minimised digest. For C, send only the banner's element text and roles, not the page.
- **A browser agent with login, payment or form-submit authority on a client's live shop.** Use test accounts and a read-only allowlist, or skip.
- **A "chat with your site" widget.** Scripted-demo risk (Trackingplan's own on-page chat is labelled scripted) and no verifiable output.
- **A fix-service upsell on top of AI findings.** GAfix does this; it conflicts with the "rules decide, the model only explains" message.
- **Model-written rule verdicts or severity.** Severity and wording stay static and stored on `check_result`.

## Open questions

- Does Tag Inspector's unseen-CMP scanning work on the CMPs that defeat autoconsent? No accuracy figure is published. A side-by-side on the same banners would settle how much C is worth.
- What does ObservePoint's MCP actually expose, and is it generally available? Its two help articles disagree.
- What is the real success rate of a funnel agent on checkout flows? No source measured it; run it on the fixtures first.
- Do agency clients allow banner text or finding text to go to a model provider? Ask three consultants before building D at default settings.

## Sources

[ObservePoint press release](https://www.webull.com/news/15713205279802368), [ObservePoint MCP help](https://help.observepoint.com/en/articles/16299323-connecting-to-the-observepoint-mcp-server), [Tag Inspector AI CMP scanning](https://infotrust.com/articles/tag-inspectors-ai-enabled-cmp-scanning-any-site-any-cmp-any-selection/), [Tag Inspector August 2026](https://infotrust.com/?p=94451), [Trackingplan](https://www.trackingplan.com), [Avo MCP](https://www.avo.app/blog/your-ai-assistant-connected-to-your-tracking-plan), [Stape AI Assistant](https://stape.io/helpdesk/documentation/ai-assistant-overview), [Coupler.io GA4 MCP test](https://blog.coupler.io/how-to-analyse-ga4-with-ai/), [MeasureU](https://measureu.com/ga4-audit-ai-claude/), [Markifact](https://www.markifact.com/blog/google-tag-manager-audit-claude), [OptimizeSmart](https://optimizesmart.com/blog/using-claude-for-ga4-gtm-ss-tagging-audit-in-great-detail/), [CSA prompt injection note](https://labs.cloudsecurityalliance.org/research/csa-research-note-indirect-prompt-injection-in-the-wild-2026/).
