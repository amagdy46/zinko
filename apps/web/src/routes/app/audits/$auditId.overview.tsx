import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router"
import { ChevronDown, Info } from "lucide-react"
import { CopyButton, RunPath } from "@/components/evidence"
import { EmptyState } from "@/components/empty-state"
import { ScoreArithmetic, ScoreDetails } from "@/components/score-arithmetic"
import { ScoreFigure } from "@/components/score-figure"
import { SeverityBadge } from "@/components/severity"
import { SectionHeading } from "@/components/section-heading"
import { StatusGlyph, type StatusMeaning } from "@/components/status-glyph"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { auditTabTitle, type TitleContext } from "@/lib/page-title"
import { AREAS, BANNER_NOTE, pagePath, runReason, scenarioLabel } from "@/lib/audit-labels"
import { count } from "@/lib/format"
import { cn } from "@/lib/utils"
import {
  type HealthScore,
  scoreCoverage as coverageOf,
  tooLittleCaptured,
} from "@/lib/health-score"
import { vendorName } from "@/lib/tag-matrix"
import { getOverview } from "@/server/overview"

const auditRoute = getRouteApi("/app/audits/$auditId")

export const Route = createFileRoute("/app/audits/$auditId/overview")({
  head: ({ matches }: TitleContext) => auditTabTitle("Overview", matches),
  loader: ({ params }) => getOverview({ data: { auditId: params.auditId } }),
  notFoundComponent: () => <p className="text-sm text-muted-foreground">Audit not found.</p>,
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
  } = Route.useLoaderData()
  if (status === "queued" || status === "running")
    return (
      <p className="text-sm text-muted-foreground" data-testid="overview-running">
        Available when the audit finishes
      </p>
    )
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
        worst={worst}
      />
      <Caveats
        auditId={audit.id}
        runs={runs}
        runHealth={runHealth}
        cause={incompleteCause}
        score={score}
        couldNotCheck={couldNotCheck}
        bannerUncertain={bannerUncertain}
      />
      <WorstFinding auditId={audit.id} worst={worst} coverage={scoreCoverage} />
      <AreaStrip auditId={audit.id} areas={areas} checkedAreas={checkedAreas} />
      <TagsSeen auditId={audit.id} tags={tags} />
      <p className="text-sm text-muted-foreground">
        Ready to send?{" "}
        <Link
          to="/app/audits/$auditId/report"
          params={{ auditId: audit.id }}
          className="inline-flex h-8 items-center rounded-md underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
}: {
  auditId: string
  runs: ReadonlyArray<AuditRun>
  runHealth: Overview["runHealth"]
  /** Why the audit is incomplete: the start page, a key page that did not load, or unfinished runs. */
  cause: string
  score: Scored
  couldNotCheck: Overview["couldNotCheck"]
  bannerUncertain: Overview["bannerUncertain"]
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
                  ? `${cause}The score describes only what could be captured, so do not read it as the state of the site.`
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
                  <li key={title}>{title}</li>
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
                        <li key={title}>{title}</li>
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
  ].filter((item) => item !== null)
  if (items.length === 0) return null
  return (
    <Collapsible
      defaultOpen={runHealth.incomplete}
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

const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"

/** A paragraph whose first sentence is the point (foreground) and the rest is support (muted). */
function Lead({ text }: { text: string }) {
  const end = text.search(/[.!?](\s|$)/) + 1
  const first = end > 0 ? text.slice(0, end) : text
  return (
    <p className="max-w-prose text-sm">
      {first}
      <span className="text-muted-foreground">{text.slice(first.length)}</span>
    </p>
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
        <SeverityBadge severity={worst.severity} />
        <h2 className="min-w-0 text-base font-semibold [overflow-wrap:anywhere]">{worst.title}</h2>
      </div>
      <p className="max-w-prose text-sm text-muted-foreground">
        Failed on {worst.failingRuns} of {worst.knownRuns} runs where it could be checked, across{" "}
        {count(worst.pages, "page")} and {count(worst.scenarios, "scenario")}.
        {worst.bannerUncertainRuns > 0
          ? ` ${count(worst.bannerUncertainRuns, "failing run")} ${rests(worst.bannerUncertainRuns)} on an undetected banner.`
          : ""}
      </p>
      <div className="space-y-1">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Why it matters
        </h3>
        <Lead text={worst.why} />
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            How to fix it
          </h3>
          <CopyButton
            value={worst.fix.map((step, i) => `${i + 1}. ${step}`).join("\n")}
            label="Copy fix steps"
          />
        </div>
        <ol className="max-w-prose list-decimal space-y-1 pl-5 text-sm">
          {worst.fix.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>
      <p className="max-w-prose text-sm">
        <span className="text-muted-foreground">First failing run: </span>
        {worst.message}
      </p>
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
        <ul className="space-y-1 text-sm" data-testid="tags-seen">
          {tags.map((tag) => (
            <li key={tag.vendor}>
              <Link
                to="/app/audits/$auditId/matrix"
                params={{ auditId }}
                className={`inline-flex min-h-8 items-center rounded-md underline underline-offset-4 ${focusRing}`}
              >
                {vendorName(tag.vendor)}: {count(tag.destinations, "destination")},{" "}
                {count(tag.events, "event")}
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
  worst,
}: {
  score: Scored
  scoreCoverage: Overview["scoreCoverage"]
  couldNotCheck: number
  open: Overview["open"]
  withoutAccepted: number | null
  scope: string
  triage: Overview["triage"]
  auditId: string
  worst: Overview["worst"]
}) {
  return (
    <section aria-label="Score" className="space-y-4 rounded-lg border bg-card p-5">
      <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-3">
          <ScoreFigure size="hero" score={score.score} band={score.band} coverage={scoreCoverage} />
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
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
        <ul className="grid grid-cols-3 gap-2 md:w-[26rem]" aria-label="Open findings">
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
      {worst === null ? null : (
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t pt-4 text-sm"
          data-testid="start-with"
        >
          <span className="text-muted-foreground">Start with</span>
          <SeverityBadge severity={worst.severity} />
          <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{worst.title}</span>
          <Button asChild size="sm" variant="outline">
            <Link
              to="/app/audits/$auditId/findings"
              params={{ auditId }}
              search={{ finding: worst.ruleId }}
            >
              Open finding
            </Link>
          </Button>
        </div>
      )}
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
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
        <StatusGlyph meaning={glyph} />
        {label}
        <span className="sr-only">: </span>
      </span>
      <span className="mt-1 block text-2xl font-semibold leading-none tabular-nums">
        {n}
        <span className="sr-only"> </span>
        <span className="ml-1.5 text-xs font-normal text-muted-foreground">{note}</span>
      </span>
    </>
  )
  const tile = "block min-h-16 min-w-0 rounded-md border bg-background px-3 py-2.5"
  return (
    <li className="min-w-0">
      {to === undefined || n === 0 ? (
        <div className={tile}>{body}</div>
      ) : (
        <Link
          to="/app/audits/$auditId/findings"
          params={{ auditId: to.auditId }}
          search={to.search}
          className={cn(tile, "hover:bg-accent", focusRing)}
        >
          {body}
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
        <span className="font-medium tabular-nums">{withoutAccepted}</span> excluding{" "}
        {count(triage.acceptedRisk, "accepted risk")}
        <span className="text-muted-foreground">
          {" "}
          · {score} counting all findings
          {triage.fixed > 0 ? `; ${triage.fixed} fixed still count` : ""}
        </span>
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
        Failing rules per area, accepted and fixed ones included. Could not check counts rules.
      </p>
    </section>
  )
}
