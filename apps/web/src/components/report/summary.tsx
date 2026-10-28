import { SeverityBadge } from "@/components/severity"
import { ScoreArithmetic, ScoreDetails } from "@/components/score-arithmetic"
import { ScoreFigure } from "@/components/score-figure"
import { SectionHeading } from "@/components/section-heading"
import { StatusGlyph } from "@/components/status-glyph"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { BANNER_NOTE } from "@/lib/audit-labels"
import { count } from "@/lib/format"
import type { ReportModel } from "@/lib/report-model"
import type { ReactNode } from "react"

/** The one-page summary: the score and how it adds up, what is uncertain, and the headlines. */
export function Summary({ model, actions }: { model: ReportModel; actions?: ReactNode }) {
  const { summary, cover, branding } = model
  const { score, runHealth, counts, coverage, worst } = summary
  const scope = [
    count(cover.scope.pages.length, "page"),
    count(cover.scope.scenarios.length, "scenario"),
    cover.scope.viewports.join(" and "),
  ].join(" × ")
  let incompleteCause = `${runHealth.unfinishedRuns} of ${coverage.totalRuns} runs did not finish. `
  if (runHealth.brokenPages.length > 0)
    incompleteCause = `Could not load ${runHealth.brokenPages.map((p) => `${p.page}${p.reason === null ? "" : `: ${p.reason}`}`).join("; ")}. `
  if (runHealth.startFailed)
    incompleteCause = `The start page could not be loaded${runHealth.startReason === null ? "" : `: ${runHealth.startReason}`}. `
  return (
    <section
      id="summary"
      aria-label="Summary"
      className="space-y-4 px-8 py-8 text-sm leading-7 print:break-before-page print:space-y-1.5 print:p-0 print:leading-snug"
    >
      <SectionHeading title="Summary" actions={actions} />
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
      <div className="space-y-2 rounded-md border p-3 print:space-y-1 print:p-2">
        <ScoreArithmetic score={score} scope={scope} maxLines={5} />
        <div className="space-y-2 text-xs text-muted-foreground">
          <ScoreDetails score={score} />
        </div>
      </div>
      <ul className="space-y-1.5">
        {coverage.unresolvedRules > 0 ? (
          <li className="flex items-start gap-2" data-testid="unresolved-checks">
            <StatusGlyph meaning="could-not-check" className="mt-0.5" />
            <span>
              Could not check: {count(coverage.unresolvedRules, "rule")}, on{" "}
              {coverage.unresolvedRuns === null
                ? "an unrecorded number of runs (this version of the report did not record it)"
                : count(coverage.unresolvedRuns, "run")}
              . They are left out of the score, never counted as passes.
            </span>
          </li>
        ) : null}
        {coverage.bannerUncertainRuns > 0 ? (
          <li className="flex items-start gap-2" data-testid="banner-note">
            <StatusGlyph meaning="could-not-check" className="mt-0.5" />
            <span>
              {count(coverage.bannerUncertainRuns, "failing consent check")} rest on an undetected
              banner. {BANNER_NOTE.summary}
            </span>
          </li>
        ) : null}
      </ul>
      <p className="flex flex-wrap gap-x-4 gap-y-1 tabular-nums" data-testid="counts">
        <span>{counts.critical} Critical</span>
        <span>{counts.warning} Warning</span>
        <span>{counts.info} Info</span>
        <span>{counts.couldNotCheck} Could not check</span>
        <span>{counts.acceptedRisk} Accepted risk</span>
        <span>{counts.fixed} Fixed</span>
      </p>
      {summary.source === "author" && summary.text !== null ? (
        <div className="space-y-1">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Summary by {branding.agencyName}
          </h3>
          <p className="whitespace-pre-line [overflow-wrap:anywhere]">{summary.text}</p>
        </div>
      ) : null}
      <div className="space-y-1">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Generated from the findings
        </h3>
        <ul className="list-disc space-y-1 pl-5" data-testid="headlines">
          {summary.headlines.map((line) => (
            <li key={line} className="[overflow-wrap:anywhere]">
              {line}
            </li>
          ))}
        </ul>
      </div>
      {worst === null ? null : (
        <p className="flex flex-wrap items-center gap-2" data-testid="worst">
          <span className="text-muted-foreground">Start with</span>
          <SeverityBadge severity={worst.severity} />
          <span className="font-medium [overflow-wrap:anywhere]">{worst.title}</span>
          <span className="text-muted-foreground">{worst.scopeLine}.</span>
        </p>
      )}
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
