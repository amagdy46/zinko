import { SeverityBadge } from "@/components/severity"
import { ScoreFigure } from "@/components/score-figure"
import { StatusGlyph } from "@/components/status-glyph"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { BANNER_NOTE } from "@/lib/audit-labels"
import { count } from "@/lib/format"
import type { ReportModel } from "@/lib/report-model"
import { isLocalAnswerCheck, namedChecks, neverCheckedLine } from "@/lib/report-projection"
import type { ReactNode } from "react"

const LINK =
  "rounded-sm text-report-accent underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"

function Headlines({ model, title }: { model: ReportModel; title: string }) {
  return (
    <div className="space-y-1">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <ul className="list-disc space-y-1 pl-5" data-testid="headlines">
        {model.summary.headlines.map((line) => (
          <li key={line} className="max-w-[65ch] [overflow-wrap:anywhere]">
            {line}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The checks that could not run, each kind in its own words: a page that did not load, a check that never ran, the rest. */
function CheckGaps({ model }: { model: ReportModel }) {
  const { checkGaps, runHealth } = model.summary
  const { brokenPages } = runHealth
  const lines: string[] = []
  if (checkGaps.blockedRules > 0)
    lines.push(
      brokenPages.length > 0
        ? `${count(brokenPages.length, "page")} could not be loaded (${brokenPages.map((p) => p.page).join(", ")}); ${count(checkGaps.blockedRules, "check")} could not run there.`
        : `${count(checkGaps.blockedRules, "check")} could not run because the start page did not load.`,
    )
  for (const title of checkGaps.neverChecked)
    if (!isLocalAnswerCheck(title)) lines.push(neverCheckedLine(title))
  if (checkGaps.otherRules > 0)
    lines.push(
      `${count(checkGaps.otherRules, "check")} could not be run on ${
        checkGaps.otherRuns === null
          ? "an unrecorded number of runs (this version of the report did not record it)"
          : count(checkGaps.otherRuns, "run")
      }${checkGaps.otherChecks === null ? "" : `: ${namedChecks(checkGaps.otherChecks)}`}. They are left out of the score, never counted as passes.`,
    )
  if (lines.length === 0) return null
  return (
    <ul className="space-y-1.5" data-testid="unresolved-checks">
      {lines.map((line) => (
        <li key={line} className="flex max-w-[65ch] items-start gap-2">
          <StatusGlyph meaning="could-not-check" className="mt-1" />
          <span>{line}</span>
        </li>
      ))}
    </ul>
  )
}

/** The one-page summary: the agency's words, the score, the counts, where to start and what could not be checked. */
export function Summary({ model, actions }: { model: ReportModel; actions?: ReactNode }) {
  const { summary, branding } = model
  const { score, runHealth, counts, coverage, worst } = summary
  let incompleteCause = `${runHealth.unfinishedRuns} of ${coverage.totalRuns} runs did not finish. `
  if (runHealth.brokenPages.length > 0)
    incompleteCause = `Could not load ${runHealth.brokenPages.map((p) => `${p.page}${p.reason === null ? "" : `: ${p.reason}`}`).join("; ")}. `
  if (runHealth.startFailed)
    incompleteCause = `The start page could not be loaded${runHealth.startReason === null ? "" : `: ${runHealth.startReason}`}. `
  const authored = summary.source === "author" && summary.text !== null
  return (
    <section
      id="summary"
      aria-label="Summary"
      className="space-y-4 px-8 py-8 text-sm leading-6 print:break-before-page print:space-y-2 print:p-0 print:leading-snug"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="text-xl font-semibold">Summary</h2>
        {actions}
      </div>
      {authored ? (
        <div className="space-y-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Summary by {branding.agencyName}
          </h3>
          <p className="max-w-[65ch] whitespace-pre-line [overflow-wrap:anywhere]">
            {summary.text}
          </p>
        </div>
      ) : (
        <Headlines model={model} title="Key findings" />
      )}
      {runHealth.incomplete ? (
        <Alert
          className="border-sev-warning-border bg-sev-warning-bg"
          data-testid="incomplete-audit"
        >
          <StatusGlyph meaning="partial" />
          <AlertTitle className="line-clamp-none">This audit is incomplete</AlertTitle>
          <AlertDescription className="text-foreground">
            {incompleteCause}
            The score below describes only what could be captured, so do not read it as the state of
            the site.
          </AlertDescription>
        </Alert>
      ) : null}
      <ScoreFigure
        size="hero"
        score={score.score}
        band={score.band}
        coverage={{
          totalRuns: coverage.totalRuns,
          evaluatedRuns: coverage.evaluatedRuns,
          unfinishedRuns: runHealth.unfinishedRuns,
          checks: summary.scoreCoverage.checks,
          unresolvedChecks: summary.scoreCoverage.unresolvedChecks,
          unauditedSites: 0,
        }}
      />
      {score.mixedVersions ? (
        <p className="text-xs text-muted-foreground">
          Mixed rules versions: runs were judged by different versions of the rules.
        </p>
      ) : null}
      <TriageNote model={model} />
      <p className="flex flex-wrap gap-x-4 gap-y-1 tabular-nums" data-testid="counts">
        <span>{counts.critical} Critical</span>
        <span>{counts.warning} Warning</span>
        <span>{counts.info} Info</span>
        <span>{counts.couldNotCheck} Could not check</span>
        <span>{counts.acceptedRisk} Accepted risk</span>
        <span>{counts.fixed} Fixed</span>
      </p>
      <p className="text-xs text-muted-foreground">
        How the score adds up is in{" "}
        <a href="#appendix" className={LINK}>
          Appendix D
        </a>
        .
      </p>
      {worst === null ? null : (
        <div className="keep-together space-y-1 rounded-md border p-3" data-testid="worst">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Start with
          </p>
          <p className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={worst.severity} />
            <span className="font-medium [overflow-wrap:anywhere]">{worst.title}</span>
          </p>
          <p className="text-muted-foreground">{worst.scopeLine}.</p>
        </div>
      )}
      <CheckGaps model={model} />
      {coverage.bannerUncertainRuns > 0 ? (
        <p className="flex max-w-[65ch] items-start gap-2" data-testid="banner-note">
          <StatusGlyph meaning="could-not-check" className="mt-1" />
          <span>
            {count(coverage.bannerUncertainRuns, "failing consent check")} rest on an undetected
            banner. {BANNER_NOTE.summary}
          </span>
        </p>
      ) : null}
      {authored ? <Headlines model={model} title="Key findings" /> : null}
    </section>
  )
}

function TriageNote({ model }: { model: ReportModel }) {
  const { summary } = model
  const { counts, score } = summary
  if (counts.acceptedRisk > 0 && summary.withoutAccepted !== null)
    return (
      <p data-testid="score-without-accepted">
        <span className="font-medium tabular-nums">{summary.withoutAccepted}</span> excluding{" "}
        {count(counts.acceptedRisk, "accepted risk")}
        <span className="text-muted-foreground">
          {" "}
          · {score.score} counting all findings
          {counts.fixed > 0 ? `; ${counts.fixed} fixed still count` : ""}
        </span>
      </p>
    )
  if (counts.fixed > 0)
    return (
      <p className="text-muted-foreground" data-testid="triage-tally">
        {counts.fixed} fixed. Fixed findings still count in the score: it describes this audit.
      </p>
    )
  return null
}
