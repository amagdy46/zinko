import { SeverityBadge } from "@/components/severity"
import { BAND_GLYPH, ScoreArithmetic, ScoreDetails } from "@/components/score-arithmetic"
import { StatusGlyph } from "@/components/status-glyph"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { BANNER_NOTE } from "@/lib/audit-labels"
import { count } from "@/lib/format"
import { BAND_LABEL } from "@/lib/health-score"
import type { ReportModel } from "@/lib/report-model"
import { cn } from "@/lib/utils"
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
      className="space-y-4 px-8 py-8 text-sm print:break-after-page"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">Summary</h2>
        {actions}
      </div>
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
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <p
          className={cn(
            "text-2xl font-semibold tabular-nums",
            runHealth.incomplete && "text-muted-foreground",
          )}
          data-testid="score"
        >
          {score.score}
          <span className="text-sm font-normal text-muted-foreground"> / 100</span>
        </p>
        <p className="flex items-center gap-2 font-medium" data-testid="band">
          {runHealth.incomplete ? (
            <>
              <StatusGlyph meaning="partial" />
              Incomplete
              <span className="font-normal text-muted-foreground">· {BAND_LABEL[score.band]}</span>
            </>
          ) : (
            <>
              <StatusGlyph meaning={BAND_GLYPH[score.band]} />
              {BAND_LABEL[score.band]}
            </>
          )}
          {score.mixedVersions ? (
            <span className="text-xs font-normal text-muted-foreground">
              · mixed rules versions
            </span>
          ) : null}
        </p>
      </div>
      <TriageNote model={model} />
      <div className="space-y-2 rounded-md border p-3">
        <ScoreArithmetic score={score} scope={scope} maxLines={5} />
        <div className="space-y-2 text-xs text-muted-foreground">
          <ScoreDetails score={score} />
        </div>
      </div>
      <ul className="space-y-1.5">
        {score.coverage === "partial" ? (
          <li className="flex items-start gap-2" data-testid="partly-evaluated">
            <StatusGlyph meaning="partial" className="mt-0.5" />
            Partly evaluated: {coverage.evaluatedRuns} of {coverage.totalRuns} runs have check
            results
          </li>
        ) : null}
        {score.uncertainty.checks > 0 ? (
          <li className="flex items-start gap-2" data-testid="unresolved-checks">
            <StatusGlyph meaning="could-not-check" className="mt-0.5" />
            <span>
              Unresolved checks: {count(score.uncertainty.rules, "rule")} could not be checked, on{" "}
              {count(score.uncertainty.runs, "run")}. They are never counted as passes.
            </span>
          </li>
        ) : null}
        {score.coverage === "full" && score.resolution === "resolved" ? (
          <li className="flex items-start gap-2" data-testid="fully-checked">
            <StatusGlyph meaning="pass" className="mt-0.5" />
            All {count(coverage.totalRuns, "run")} evaluated, every check resolved
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
