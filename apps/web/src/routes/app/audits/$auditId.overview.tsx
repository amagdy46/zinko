import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router"
import { useEffect, useRef } from "react"
import { ChevronDown, Info } from "lucide-react"
import { AuditRunning } from "@/components/audit-running"
import { CopyButton, RunPath } from "@/components/evidence"
import { EmptyState } from "@/components/empty-state"
import { OverviewSkeleton } from "@/components/page-skeleton"
import { ScoreArithmetic, ScoreDetails } from "@/components/score-arithmetic"
import { ScoreFigure } from "@/components/score-figure"
import { SeverityBadge } from "@/components/severity"
import { SectionHeading } from "@/components/section-heading"
import { Stat } from "@/components/stat"
import { StatusGlyph, type StatusMeaning } from "@/components/status-glyph"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { auditTabTitle, type TitleContext } from "@/lib/page-title"
import { AREAS, BANNER_NOTE, pagePath, runReason, scenarioLabel } from "@/lib/audit-labels"
import { count } from "@/lib/format"
import { setLocalFlag, useLocalFlag } from "@/lib/local-flag"
import { usePreviewed } from "@/lib/report-previewed"
import { checkGapReason } from "@/lib/report-projection"
import { cn } from "@/lib/utils"
import {
  type HealthScore,
  scoreCoverage as coverageOf,
  tooLittleCaptured,
} from "@/lib/health-score"
import { vendorName } from "@/lib/tag-matrix"
import { Briefing, RecheckResult } from "@/components/compare/briefing"
import { getOverview } from "@/server/overview"

const auditRoute = getRouteApi("/app/audits/$auditId")

export const Route = createFileRoute("/app/audits/$auditId/overview")({
  head: ({ matches }: TitleContext) => auditTabTitle("Overview", matches),
  loader: ({ params }) => getOverview({ data: { auditId: params.auditId } }),
  notFoundComponent: () => <p className="text-sm text-muted-foreground">Audit not found.</p>,
  pendingComponent: OverviewSkeleton,
  component: OverviewScreen,
})

type Overview = Awaited<ReturnType<typeof getOverview>>
type AuditRun = ReturnType<typeof auditRoute.useLoaderData>["runs"][number]
type Scored = Extract<HealthScore, { evaluated: true }>

const SEVERITIES = ["critical", "warning", "info"] as const
const SEVERITY_LABEL = { critical: "Critical", warning: "Warning", info: "Info" } as const

const CAVEAT_LIST = 5

const rests = (n: number) => (n === 1 ? "rests" : "rest")

function OverviewScreen() {
  const { audit, runs } = auditRoute.useLoaderData()
  const {
    status,
    score,
    coverage,
    areas,
    checkedAreas,
    triage,
    bannerUncertain,
    worst,
    tags,
    withoutAccepted,
    couldNotCheck,
    runHealth,
    scoreCoverage,
    open,
    nextSteps,
  } = Route.useLoaderData()
  const { briefing, recheck, bandAllAccepted } = Route.useLoaderData()
  if (status === "queued" || status === "running")
    return <AuditRunning what="The score, findings and next steps" testId="overview-running" />
  if (!score.evaluated)
    return (
      <EmptyState
        title="Not evaluated"
        dashed
        description="No run of this audit has check results: it ran before Zinko checked rules, or none of its runs was saved. Nothing can be said about its tracking, and it is not clean."
      />
    )
  const brokenPages = runHealth.brokenPages
    .map((p) => `${pagePath(p.page)}${p.reason === null ? "" : `: ${p.reason}`}`)
    .join("; ")
  let incompleteCause = `${runHealth.unfinishedRuns} of ${coverage.totalRuns} runs did not finish. `
  if (runHealth.brokenPages.length > 0) incompleteCause = `Could not load ${brokenPages}. `
  if (runHealth.startFailed)
    incompleteCause = `The start page${runHealth.startPage === null ? "" : ` (${runHealth.startPage})`} could not be loaded${runHealth.startReason === null ? "" : `: ${runHealth.startReason}`}. `
  const scope = [
    count(audit.config.pages.length, "page"),
    count(audit.config.scenarios.length, "scenario"),
    audit.config.viewports.join(" and "),
  ].join(" × ")
  if (recheck !== null)
    return (
      <div className="min-w-0 space-y-6">
        <RecheckResult {...recheck} />
        <Caveats
          auditId={audit.id}
          runs={runs}
          runHealth={runHealth}
          cause={incompleteCause}
          score={score}
          couldNotCheck={couldNotCheck}
          bannerUncertain={bannerUncertain}
          scored={false}
        />
        {worst === null ? null : (
          <WorstFinding auditId={audit.id} worst={worst} coverage={scoreCoverage} />
        )}
      </div>
    )
  return (
    <div className="min-w-0 space-y-6">
      <ScoreBlock
        score={score}
        scoreCoverage={scoreCoverage}
        couldNotCheck={couldNotCheck.rules}
        open={open}
        withoutAccepted={withoutAccepted}
        scope={scope}
        triage={triage}
        auditId={audit.id}
        bandAllAccepted={bandAllAccepted}
      />
      {briefing === null ? null : (
        <Briefing auditId={audit.id} since={briefing.since} lines={briefing.lines} />
      )}
      <WorstFinding auditId={audit.id} worst={worst} coverage={scoreCoverage} />
      <NextSteps auditId={audit.id} worstRuleId={worst?.ruleId} steps={nextSteps} />
      <Caveats
        auditId={audit.id}
        runs={runs}
        runHealth={runHealth}
        cause={incompleteCause}
        score={score}
        couldNotCheck={couldNotCheck}
        bannerUncertain={bannerUncertain}
      />
      <AreaStrip auditId={audit.id} areas={areas} checkedAreas={checkedAreas} />
      <TagsSeen auditId={audit.id} tags={tags} />
      <p className="text-sm text-muted-foreground">
        Ready to send?{" "}
        <Link
          to="/app/audits/$auditId/report"
          params={{ auditId: audit.id }}
          className="inline-flex h-8 items-center rounded-md underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Open the report
        </Link>
      </p>
    </div>
  )
}

/**
 * Everything that qualifies the score, in one disclosure: runs that did not finish (the list of
 * runs), checks that could not run, an undetected consent banner, mixed rules versions. Open
 * when the audit is incomplete, closed otherwise.
 */
function Caveats({
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
    <Collapsible
      defaultOpen={runHealth.incomplete || problems.length > 0}
      className="rounded-lg border border-dashed"
      data-testid="caveats"
    >
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

/** Why a check was not run, when it is by design; nothing for the rest. */
function GapReason({ title }: { title: string }) {
  const reason = checkGapReason(title)
  return reason === null ? null : <span className="block text-xs">{reason}</span>
}

const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"

/** The first sentence is the point (foreground); the rest is support, in a paragraph of its own so a tone never changes mid-sentence. */
function Lead({ text }: { text: string }) {
  const end = text.search(/[.!?](\s|$)/) + 1
  const first = end > 0 ? text.slice(0, end) : text
  const rest = text.slice(first.length).trim()
  return (
    <>
      <p className="text-sm">{first}</p>
      {rest === "" ? null : <p className="text-sm text-muted-foreground">{rest}</p>}
    </>
  )
}

const NEXT_STEPS_HIDDEN = "zinko:next-steps-hidden"

const stepLink =
  "inline-flex min-h-8 items-center rounded-md font-medium underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"

/**
 * From a finished audit to a shared report, derived from what is stored: triage rows and report
 * notes, a report edit or published version, a live share link. Reading the top finding leaves no
 * trace, so it counts as done once a later step is. Once a link exists it shrinks to one line, the
 * only place the Overview mentions it (the address itself is shown once, at creation).
 */
function NextSteps({
  auditId,
  worstRuleId,
  steps,
}: {
  auditId: string
  worstRuleId: string | undefined
  steps: Overview["nextSteps"]
}) {
  const previewed = usePreviewed(auditId)
  const hidden = useLocalFlag(NEXT_STEPS_HIDDEN)
  const hideButton = useRef<HTMLButtonElement>(null)
  const showButton = useRef<HTMLButtonElement>(null)
  const toggled = useRef(false)
  // the control that was pressed unmounts, so focus follows to its counterpart
  useEffect(() => {
    const moveFocus = toggled.current
    toggled.current = false
    if (moveFocus) (hidden ? showButton : hideButton).current?.focus()
  }, [hidden])
  const toggle = (hide: boolean) => {
    toggled.current = true
    setLocalFlag(NEXT_STEPS_HIDDEN, hide)
  }
  if (steps.shared)
    return (
      <p className="text-sm text-muted-foreground" data-testid="active-share">
        Active share link.{" "}
        <Link
          to="/app/audits/$auditId/report"
          params={{ auditId }}
          search={{ share: 1 }}
          className={stepLink}
        >
          Manage in Share
        </Link>
      </p>
    )
  const items = [
    ...(steps.hasFindings
      ? [
          {
            key: "triage",
            done: steps.triaged,
            link: (
              <Link
                to="/app/audits/$auditId/findings"
                params={{ auditId }}
                search={worstRuleId === undefined ? {} : { finding: worstRuleId }}
                className={stepLink}
              >
                Read the top finding
              </Link>
            ),
            hint: "Read what it means for the site. Triage it only when you know its status.",
          },
        ]
      : []),
    {
      key: "preview",
      done: steps.reportReviewed || previewed,
      link: (
        <Link
          to="/app/audits/$auditId/report"
          params={{ auditId }}
          search={{ view: "client" }}
          className={stepLink}
        >
          Preview the reader view
        </Link>
      ),
      hint: "See what a reader of the report will see.",
    },
    {
      key: "share",
      done: false,
      link: (
        <Link
          to="/app/audits/$auditId/report"
          params={{ auditId }}
          search={{ share: 1 }}
          className={stepLink}
        >
          Create a share link
        </Link>
      ),
      hint: "Send a link to the report.",
    },
  ]
  if (hidden)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Next steps are hidden.{" "}
        <Button
          ref={showButton}
          variant="ghost"
          size="sm"
          className="px-1.5 underline underline-offset-4"
          onClick={() => toggle(false)}
        >
          Show them
        </Button>
      </p>
    )
  return (
    <section
      aria-label="Next steps"
      className="space-y-3 rounded-lg border bg-card p-4 shadow-xs"
      data-testid="next-steps"
    >
      <SectionHeading
        title="Next steps"
        className="items-center"
        actions={
          <Button
            ref={hideButton}
            variant="ghost"
            size="sm"
            className="-mr-2 text-muted-foreground"
            onClick={() => toggle(true)}
          >
            Hide
          </Button>
        }
      />
      <ol className="grid gap-4 text-sm md:grid-cols-3 md:gap-6">
        {items.map((item, i) => (
          <li key={item.key} className="flex items-start gap-2.5">
            {item.done ? (
              <StatusGlyph meaning="pass" className="mt-1" />
            ) : (
              <span
                aria-hidden="true"
                className="mt-1 flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-2xs font-medium text-muted-foreground tabular-nums"
              >
                {i + 1}
              </span>
            )}
            <span className="min-w-0">
              {item.link}
              {item.done ? <span className="text-muted-foreground"> (done)</span> : null}
              {"hint" in item && !item.done ? (
                <span className="block text-xs text-muted-foreground">{item.hint}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}

function WorstFinding({
  auditId,
  worst,
  coverage,
}: {
  auditId: string
  worst: Overview["worst"]
  coverage: Overview["scoreCoverage"]
}) {
  if (worst === null) {
    // a pass glyph only when the runs were all captured: "nothing failed" says little about a page
    // that never loaded
    const partial = coverageOf(coverage).state === "runs"
    let text = "No open failing findings"
    if (partial)
      text = tooLittleCaptured(coverage)
        ? "Too little was captured to say whether anything fails"
        : "No open failing findings in the runs that were captured"
    return (
      <section aria-label="Worst finding" className="rounded-lg border bg-card p-4 text-sm">
        <p className="flex items-center gap-2" data-testid="no-open-findings">
          <StatusGlyph meaning={partial ? "partial" : "pass"} />
          {text}
        </p>
      </section>
    )
  }
  return (
    <section
      aria-label="Worst finding"
      className="space-y-3 rounded-lg border bg-card p-4"
      data-testid="worst-finding"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="type-label">Start with</span>
        <SeverityBadge severity={worst.severity} />
        <h2 className="min-w-0 text-base font-semibold [overflow-wrap:anywhere]">{worst.title}</h2>
      </div>
      <p className="max-w-prose text-sm text-muted-foreground">
        Failed on {worst.failingRuns} of {count(worst.knownRuns, "run")} where it could be checked,
        across {count(worst.pages, "page")} and {count(worst.scenarios, "scenario")}.
        {worst.bannerUncertainRuns > 0
          ? ` ${count(worst.bannerUncertainRuns, "failing run")} ${rests(worst.bannerUncertainRuns)} on an undetected banner.`
          : ""}
      </p>
      <div className="grid items-start gap-6 md:grid-cols-2 md:gap-10">
        <div className="max-w-prose space-y-2">
          <div className="flex items-center md:h-8">
            <h3 className="type-label">Why it matters</h3>
          </div>
          <Lead text={worst.why} />
          <p className="pt-1 text-sm">
            <span className="type-label block">First failing run</span>
            {worst.message}
          </p>
        </div>
        <div className="max-w-prose space-y-2">
          <div className="flex h-8 items-center justify-between gap-2">
            <h3 className="type-label">How to fix it</h3>
            <CopyButton
              value={worst.fix.map((step, i) => `${i + 1}. ${step}`).join("\n")}
              label="Copy fix steps"
            />
          </div>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {worst.fix.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link
            to="/app/audits/$auditId/findings"
            params={{ auditId }}
            search={{ finding: worst.ruleId }}
          >
            Open in Findings
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link
            to="/app/audits/$auditId/hits"
            params={{ auditId }}
            search={{ runId: worst.firstRunId }}
          >
            Open in Hits
          </Link>
        </Button>
      </div>
    </section>
  )
}

function TagsSeen({ auditId, tags }: { auditId: string; tags: Overview["tags"] }) {
  return (
    <section aria-label="Tags seen" className="space-y-2">
      <SectionHeading title="Tags seen" />
      {tags.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="no-tags">
          No tags were seen.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2 text-sm" data-testid="tags-seen">
          {tags.map((tag) => (
            <li key={tag.vendor}>
              <Link
                to="/app/audits/$auditId/matrix"
                params={{ auditId }}
                className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border bg-card px-3 hover:bg-muted/50 ${focusRing}`}
              >
                <span className="font-medium">{vendorName(tag.vendor)}</span>
                <span className="text-muted-foreground">
                  {count(tag.destinations, "destination")}, {count(tag.events, "event")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ScoreBlock({
  score,
  scoreCoverage,
  couldNotCheck,
  open,
  withoutAccepted,
  scope,
  triage,
  auditId,
  bandAllAccepted,
}: {
  score: Scored
  scoreCoverage: Overview["scoreCoverage"]
  couldNotCheck: number
  open: Overview["open"]
  withoutAccepted: number | null
  scope: string
  triage: Overview["triage"]
  auditId: string
  bandAllAccepted: boolean
}) {
  return (
    <section aria-label="Score" className="space-y-4 rounded-lg border bg-card p-5">
      <div className="grid gap-6 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] md:items-center md:gap-10">
        <div className="min-w-0 space-y-2">
          <ScoreFigure
            size="hero"
            score={score.score}
            band={score.band}
            bandAllAccepted={bandAllAccepted}
            coverage={scoreCoverage}
          />
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="-ml-3 text-muted-foreground">
                <Info aria-hidden="true" />
                How this is scored
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              collisionPadding={16}
              className="max-h-[min(36rem,var(--radix-popover-content-available-height))] w-[min(30rem,calc(100vw-2rem))] space-y-3 overflow-y-auto text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            >
              <Arithmetic score={score} scope={scope} />
            </PopoverContent>
          </Popover>
        </div>
        <ul
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 [&>li:last-child]:max-sm:col-span-2"
          aria-label="Open findings"
        >
          {(["critical", "warning"] as const).map((severity) => (
            <StatTile
              key={severity}
              glyph={severity}
              label={SEVERITY_LABEL[severity]}
              n={open[severity]}
              note="open"
              to={{ auditId, search: { severity } }}
            />
          ))}
          <StatTile
            glyph="could-not-check"
            label="Could not check"
            n={couldNotCheck}
            note={couldNotCheck === 1 ? "rule" : "rules"}
          />
        </ul>
      </div>
      <TriageNote triage={triage} score={score.score} withoutAccepted={withoutAccepted} />
    </section>
  )
}

function StatTile({
  glyph,
  label,
  n,
  note,
  to,
}: {
  glyph: StatusMeaning
  label: string
  n: number
  note: string
  to?: { auditId: string; search: { severity: (typeof SEVERITIES)[number] } }
}) {
  const stat = <Stat glyph={glyph} label={label} value={n} unit={note} />
  return (
    <li className="min-w-0">
      {to === undefined || n === 0 ? (
        stat
      ) : (
        <Link
          to="/app/audits/$auditId/findings"
          params={{ auditId: to.auditId }}
          search={to.search}
          className={cn("group/stat block rounded-lg", focusRing)}
        >
          {stat}
        </Link>
      )}
    </li>
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

const SEGMENTS = [
  { key: "critical", label: "Critical", glyph: "critical", fill: "fill-sev-critical-solid" },
  { key: "warning", label: "Warning", glyph: "warning", fill: "fill-sev-warning-solid" },
  { key: "info", label: "Info", glyph: "info", fill: "fill-sev-info-solid" },
  {
    key: "couldNotCheck",
    label: "Could not check",
    glyph: "could-not-check",
    fill: "fill-muted-foreground/40",
  },
] as const

function AreaStrip({
  auditId,
  areas,
  checkedAreas,
}: {
  auditId: string
  areas: Overview["areas"]
  checkedAreas: Overview["checkedAreas"]
}) {
  const all = Object.entries(AREAS)
  const shown = all.flatMap(([area, label]) => {
    const found = areas[area]
    return found === undefined ? [] : [{ area, label, found }]
  })
  const quiet = all.filter(([area]) => areas[area] === undefined)
  const passed = quiet.filter(([area]) => (checkedAreas[area] ?? 0) > 0).map(([, label]) => label)
  const unchecked = quiet
    .filter(([area]) => (checkedAreas[area] ?? 0) === 0)
    .map(([, label]) => label)
  const widest = Math.max(
    1,
    ...shown.map(({ found }) => SEGMENTS.reduce((n, seg) => n + found[seg.key], 0)),
  )
  return (
    <section aria-label="Counts by area" className="space-y-3">
      <SectionHeading title="Counts by area" />
      {shown.length > 0 ? (
        <ul className="divide-y rounded-lg border bg-card">
          {shown.map(({ area, label, found }) => {
            let offset = 0
            return (
              <li
                key={area}
                className="grid items-center gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[8rem_minmax(6rem,1fr)_minmax(0,19rem)]"
              >
                <span className="text-sm font-medium">{label}</span>
                <svg aria-hidden="true" className="h-2 w-full">
                  <rect width="100%" height="100%" rx="4" className="fill-muted" />
                  {SEGMENTS.map((seg) => {
                    const x = (offset / widest) * 100
                    offset += found[seg.key]
                    return found[seg.key] === 0 ? null : (
                      <rect
                        key={seg.key}
                        x={`${x}%`}
                        width={`${(found[seg.key] / widest) * 100}%`}
                        height="100%"
                        className={cn(seg.fill, "stroke-card")}
                        strokeWidth="1"
                      />
                    )
                  })}
                </svg>
                <span className="flex flex-wrap gap-x-3 text-sm">
                  {SEGMENTS.map((seg) =>
                    found[seg.key] === 0 ? null : (
                      <Link
                        key={seg.key}
                        to="/app/audits/$auditId/findings"
                        params={{ auditId }}
                        search={{
                          area,
                          severity: seg.key === "couldNotCheck" ? undefined : seg.key,
                        }}
                        className={`inline-flex min-h-8 items-center gap-1.5 rounded-md tabular-nums underline-offset-4 hover:underline ${focusRing}`}
                      >
                        <StatusGlyph meaning={seg.glyph} />
                        {found[seg.key]} {seg.label}
                      </Link>
                    ),
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      ) : null}
      <ul className="space-y-1 text-sm text-muted-foreground" data-testid="quiet-areas">
        {passed.length > 0 ? (
          <li className="flex items-start gap-2">
            <StatusGlyph meaning="pass" className="mt-0.5" />
            <span>No failures in {passed.join(", ")}: checks ran and passed.</span>
          </li>
        ) : null}
        {unchecked.length > 0 ? (
          <li className="flex items-start gap-2">
            <StatusGlyph meaning="not-applicable" className="mt-0.5" />
            <span>
              Nothing was checked in {unchecked.join(", ")} (not evaluated or not applicable).
            </span>
          </li>
        ) : null}
      </ul>
      <p className="text-xs text-muted-foreground">
        Failing rules per area, accepted and fixed ones included. Could not check counts rules. Bars
        share one scale: the longest is {count(widest, "rule")}.
      </p>
    </section>
  )
}
