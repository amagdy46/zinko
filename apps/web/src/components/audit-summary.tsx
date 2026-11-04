import { Link } from "@tanstack/react-router"
import { ChevronDown, Info } from "lucide-react"
import { RunPath } from "@/components/evidence"
import { ScoreArithmetic, ScoreDetails } from "@/components/score-arithmetic"
import { ScoreChip, ScoreFigure } from "@/components/score-figure"
import { StatusGlyph } from "@/components/status-glyph"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { BANNER_NOTE, pagePath, runReason, scenarioLabel } from "@/lib/audit-labels"
import { count } from "@/lib/format"
import { type HealthScore, tooLittleCaptured } from "@/lib/health-score"
import { checkGapReason } from "@/lib/report-projection"
import { cn } from "@/lib/utils"
import type { getAudit } from "@/server/audits"
import type { getOverview } from "@/server/overview"

export type Overview = Awaited<ReturnType<typeof getOverview>>
type AuditRun = Awaited<ReturnType<typeof getAudit>>["runs"][number]
export type Scored = Extract<HealthScore, { evaluated: true }>

const CAVEAT_LIST = 5

const rests = (n: number) => (n === 1 ? "rests" : "rest")

const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"

/** Why the audit is incomplete: the start page, a key page that did not load, or unfinished runs. */
export const incompleteCauseOf = (runHealth: Overview["runHealth"], totalRuns: number) => {
  if (runHealth.startFailed)
    return `The start page${runHealth.startPage === null ? "" : ` (${runHealth.startPage})`} could not be loaded${runHealth.startReason === null ? "" : `: ${runHealth.startReason}`}. `
  if (runHealth.brokenPages.length > 0)
    return `Could not load ${runHealth.brokenPages
      .map((p) => `${pagePath(p.page)}${p.reason === null ? "" : `: ${p.reason}`}`)
      .join("; ")}. `
  return `${runHealth.unfinishedRuns} of ${totalRuns} runs did not finish. `
}

/** The score at the top of Problems. How it adds up, and what it counts, is one click away. */
export function ScoreLine({
  score,
  scoreCoverage,
  scope,
  triage,
  withoutAccepted,
}: {
  score: Scored
  scoreCoverage: Overview["scoreCoverage"]
  scope: string
  triage: Overview["triage"]
  withoutAccepted: number | null
}) {
  return (
    <section aria-label="Score" className="flex items-start gap-2">
      {tooLittleCaptured(scoreCoverage) ? (
        <ScoreFigure score={score.score} coverage={scoreCoverage} />
      ) : (
        <ScoreChip score={score.score} band={score.band} coverage={scoreCoverage} />
      )}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="text-muted-foreground">
            <Info aria-hidden="true" />
            How this is scored
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          collisionPadding={16}
          className="max-h-[min(36rem,var(--radix-popover-content-available-height))] w-[min(30rem,calc(100vw-2rem))] space-y-3 overflow-y-auto text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <TriageNote triage={triage} score={score.score} withoutAccepted={withoutAccepted} />
          <Arithmetic score={score} scope={scope} />
        </PopoverContent>
      </Popover>
    </section>
  )
}

function TriageNote({
  triage,
  score,
  withoutAccepted,
}: {
  triage: Overview["triage"]
  score: number
  withoutAccepted: number | null
}) {
  if (triage.acceptedRisk > 0 && withoutAccepted !== null)
    return (
      <p className="text-sm" data-testid="score-without-accepted">
        The score of {score} counts all findings, including{" "}
        {count(triage.acceptedRisk, "accepted risk")}. Without{" "}
        {triage.acceptedRisk === 1 ? "it" : "them"}:{" "}
        <span className="font-medium tabular-nums">{withoutAccepted}</span>.
        {triage.fixed > 0 ? (
          <span className="text-muted-foreground">
            {" "}
            {triage.fixed} fixed {triage.fixed === 1 ? "finding counts" : "findings count"} too: the
            score describes this audit.
          </span>
        ) : null}
      </p>
    )
  if (triage.fixed > 0)
    return (
      <p className="text-sm text-muted-foreground" data-testid="triage-tally">
        {triage.fixed} fixed. Fixed findings still count in the score: it describes this audit.
      </p>
    )
  return null
}

function Arithmetic({ score, scope }: { score: Scored; scope: string }) {
  return (
    <>
      <ScoreArithmetic score={score} scope={scope} />
      <Collapsible>
        <CollapsibleTrigger
          className={cn(
            "group flex min-h-8 items-center gap-1.5 rounded-md text-xs font-medium",
            focusRing,
          )}
        >
          Details
          <ChevronDown
            aria-hidden="true"
            className="size-4 transition-transform group-data-[state=open]:rotate-180"
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 text-xs text-muted-foreground">
          <ScoreDetails score={score} />
        </CollapsibleContent>
      </Collapsible>
    </>
  )
}

/** Why a check was not run, when it is by design; nothing for the rest. */
function GapReason({ title }: { title: string }) {
  const reason = checkGapReason(title)
  return reason === null ? null : <span className="block text-xs">{reason}</span>
}

export function Caveats({
  auditId,
  runs,
  runHealth,
  cause,
  score,
  couldNotCheck,
  bannerUncertain,
  scored = true,
}: {
  auditId: string
  runs: ReadonlyArray<AuditRun>
  runHealth: Overview["runHealth"]
  /** Why the audit is incomplete: the start page, a key page that did not load, or unfinished runs. */
  cause: string
  score: Scored
  couldNotCheck: Overview["couldNotCheck"]
  bannerUncertain: Overview["bannerUncertain"]
  /** False for a re-check, which has a result and no score. */
  scored?: boolean
}) {
  const problems = runs.filter((r) => r.status === "partial" || r.status === "failed")
  const failed = problems.filter((r) => r.status === "failed").length
  const split = [
    failed > 0 && `${failed} failed`,
    problems.length - failed > 0 && `${problems.length - failed} partial`,
  ]
    .filter(Boolean)
    .join(", ")
  const { uncertainty } = score
  const unchecked = couldNotCheck.titles
  const items = [
    problems.length > 0 || runHealth.incomplete
      ? {
          key: "runs",
          node: (
            <div data-testid={runHealth.incomplete ? "incomplete-audit" : "unfinished-runs"}>
              <p>
                <span className="font-medium">
                  {runHealth.incomplete
                    ? "This audit is incomplete. "
                    : `${problems.length} of ${runs.length} runs could not finish (${split}). `}
                </span>
                {runHealth.incomplete
                  ? `${cause}The ${scored ? "score" : "result"} describes only what could be captured, so do not read it as the state of the site.`
                  : "Their results are missing or incomplete."}
              </p>
              {problems.length > 0 ? (
                <Collapsible>
                  <CollapsibleTrigger
                    className={cn(
                      "group flex min-h-8 items-center gap-1.5 rounded-md text-xs font-medium",
                      focusRing,
                    )}
                  >
                    See which runs
                    <ChevronDown
                      aria-hidden="true"
                      className="size-4 transition-transform group-data-[state=open]:rotate-180"
                    />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <ul className="space-y-1">
                      {problems.map((run) => (
                        <li key={run.id}>
                          <Link
                            to="/app/audits/$auditId"
                            params={{ auditId }}
                            search={{ view: "matrix", run: run.id }}
                            className={`flex items-start gap-2 rounded-sm py-1.5 underline-offset-4 hover:underline ${focusRing}`}
                          >
                            <StatusGlyph meaning={run.status === "failed" ? "failed" : "partial"} />
                            <span className="min-w-0 [overflow-wrap:anywhere]">
                              <RunPath run={run} className="max-w-full" /> ·{" "}
                              {scenarioLabel(run.scenario)} · {run.viewport}: {runReason(run)}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </CollapsibleContent>
                </Collapsible>
              ) : null}
            </div>
          ),
        }
      : null,
    couldNotCheck.rules > 0
      ? {
          key: "unresolved",
          node: (
            <div data-testid="unresolved-checks">
              <p>
                <span className="font-medium">
                  Could not check: {count(couldNotCheck.rules, "rule")}, on{" "}
                  {count(couldNotCheck.runs, "run")}.{" "}
                </span>
                They are left out of the score, never counted as passes.
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
                {unchecked.slice(0, CAVEAT_LIST).map((title) => (
                  <li key={title}>
                    {title}
                    <GapReason title={title} />
                  </li>
                ))}
              </ul>
              {unchecked.length > CAVEAT_LIST ? (
                <Collapsible>
                  <CollapsibleTrigger
                    className={cn(
                      "group flex min-h-8 items-center gap-1.5 rounded-md text-xs font-medium",
                      focusRing,
                    )}
                  >
                    and {unchecked.length - CAVEAT_LIST} more
                    <ChevronDown
                      aria-hidden="true"
                      className="size-4 transition-transform group-data-[state=open]:rotate-180"
                    />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                      {unchecked.slice(CAVEAT_LIST).map((title) => (
                        <li key={title}>
                          {title}
                          <GapReason title={title} />
                        </li>
                      ))}
                    </ul>
                  </CollapsibleContent>
                </Collapsible>
              ) : null}
            </div>
          ),
        }
      : null,
    bannerUncertain.length > 0
      ? {
          key: "banner",
          node: (
            <div data-testid="banner-alert">
              <p>
                <span className="font-medium">
                  {count(uncertainty.bannerUncertainRuns, "failing consent check")}{" "}
                  {rests(uncertainty.bannerUncertainRuns)} on an undetected banner.{" "}
                </span>
                {BANNER_NOTE.summary} The findings keep their severity and their weight in the
                score.
              </p>
              <p className="text-muted-foreground">
                {bannerUncertain.map((f) => `${f.title} (${count(f.runs, "run")})`).join(", ")}
              </p>
            </div>
          ),
        }
      : null,
    score.mixedVersions
      ? {
          key: "versions",
          node: (
            <p data-testid="mixed-versions">
              <span className="font-medium">Mixed rules versions. </span>
              The runs were evaluated with different versions of the rules (
              {score.versions.join(", ")}
              ). The checks and their wording can differ between them.
            </p>
          ),
        }
      : null,
  ]
    .filter((item) => item !== null)
    .filter((item) => scored || item.key === "runs")
  if (items.length === 0) return null
  return (
    <Collapsible className="rounded-lg border border-dashed" data-testid="caveats">
      <CollapsibleTrigger
        className={cn(
          "group flex min-h-10 w-full items-center gap-2 rounded-lg px-4 text-left text-sm font-medium",
          focusRing,
        )}
      >
        <StatusGlyph meaning="partial" />
        {count(items.length, "caveat")}
        <span className="font-normal text-muted-foreground">
          {runHealth.incomplete ? "· read these before the score" : "· what qualifies the score"}
        </span>
        <ChevronDown
          aria-hidden="true"
          className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="max-w-prose space-y-3 px-4 pb-4 text-sm">
          {items.map((item) => (
            <li key={item.key}>{item.node}</li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}
