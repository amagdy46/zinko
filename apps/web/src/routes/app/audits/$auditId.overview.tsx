import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router"
import { ChevronDown, CircleDashed, Info } from "lucide-react"
import { CopyButton } from "@/components/evidence"
import { EmptyState } from "@/components/empty-state"
import { SeverityBadge } from "@/components/severity"
import { StatusGlyph, type StatusMeaning } from "@/components/status-glyph"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { AREAS, BANNER_NOTE } from "@/lib/audit-labels"
import { count } from "@/lib/format"
import { cn } from "@/lib/utils"
import { BAND_LABEL, CRITICAL_CAP, type Band, type HealthScore, WEIGHT } from "@/lib/health-score"
import { vendorName } from "@/lib/tag-matrix"
import { getOverview } from "@/server/overview"

const auditRoute = getRouteApi("/app/audits/$auditId")

export const Route = createFileRoute("/app/audits/$auditId/overview")({
  loader: ({ params }) => getOverview({ data: { auditId: params.auditId } }),
  notFoundComponent: () => <p className="text-sm text-muted-foreground">Audit not found.</p>,
  component: OverviewScreen,
})

type Overview = Awaited<ReturnType<typeof getOverview>>
type Scored = Extract<HealthScore, { evaluated: true }>

const BAND_GLYPH: Record<Band, StatusMeaning> = {
  critical: "critical",
  attention: "warning",
  minor: "info",
  "no-failures": "pass",
}

const SEVERITIES = ["critical", "warning", "info"] as const
const SEVERITY_LABEL = { critical: "Critical", warning: "Warning", info: "Info" } as const

const PURCHASE_FIELDS_RULE = "coverage.purchase-missing-fields"

const rests = (n: number) => (n === 1 ? "rests" : "rest")

function OverviewScreen() {
  const { audit } = auditRoute.useLoaderData()
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
    runHealth,
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
        description="No run of this audit has check results: it ran before Zinko checked rules, or none of its runs was saved. Nothing can be said about its tracking, and it is not clean."
      />
    )
  const scope = [
    count(audit.config.pages.length, "page"),
    count(audit.config.scenarios.length, "scenario"),
    audit.config.viewports.join(" and "),
  ].join(" × ")
  return (
    <div className="min-w-0 space-y-6">
      {runHealth.incomplete ? (
        <Alert
          role="status"
          className="border-sev-warning-border bg-sev-warning-bg"
          data-testid="incomplete-audit"
        >
          <StatusGlyph meaning="partial" />
          <AlertTitle className="line-clamp-none">This audit is incomplete</AlertTitle>
          <AlertDescription className="text-foreground">
            {runHealth.startFailed
              ? `The start page${runHealth.startPage === null ? "" : ` (${runHealth.startPage})`} could not be loaded${runHealth.startReason === null ? "" : `: ${runHealth.startReason}`}. `
              : `${runHealth.unfinishedRuns} of ${coverage.totalRuns} runs did not finish. `}
            The score below describes only what could be captured, so do not read it as the state of
            the site.
          </AlertDescription>
        </Alert>
      ) : null}
      <ScoreBlock
        score={score}
        withoutAccepted={withoutAccepted}
        incomplete={runHealth.incomplete}
        evaluated={coverage.evaluatedRuns}
        totalRuns={coverage.totalRuns}
        scope={scope}
        triage={triage}
        auditId={audit.id}
        worst={worst}
      />
      {score.mixedVersions ? (
        <Alert
          role="status"
          className="border-sev-warning-border bg-sev-warning-bg"
          data-testid="mixed-versions"
        >
          <AlertTitle className="line-clamp-none">Mixed rules versions</AlertTitle>
          <AlertDescription className="text-foreground">
            The runs were evaluated with different versions of the rules (
            {score.versions.join(", ")}
            ). The checks and their wording can differ between them.
          </AlertDescription>
        </Alert>
      ) : null}
      {bannerUncertain.length > 0 ? (
        <Alert role="status" className="border-dashed" data-testid="banner-alert">
          <CircleDashed aria-hidden="true" />
          <AlertTitle className="line-clamp-none">
            {count(score.uncertainty.bannerUncertainRuns, "failing consent check")}{" "}
            {rests(score.uncertainty.bannerUncertainRuns)} on an undetected banner
          </AlertTitle>
          <AlertDescription>
            <p>
              {BANNER_NOTE.summary} The findings keep their severity and their weight in the score.
            </p>
            <p>{bannerUncertain.map((f) => `${f.title} (${count(f.runs, "run")})`).join(", ")}</p>
          </AlertDescription>
        </Alert>
      ) : null}
      <WorstFinding auditId={audit.id} worst={worst} />
      <AreaCounts auditId={audit.id} areas={areas} checkedAreas={checkedAreas} />
      <TagsSeen auditId={audit.id} tags={tags} />
    </div>
  )
}

const focusRing = "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"

function WorstFinding({ auditId, worst }: { auditId: string; worst: Overview["worst"] }) {
  if (worst === null)
    return (
      <section aria-label="Worst finding" className="rounded-lg border bg-card p-4 text-sm">
        <p className="flex items-center gap-2" data-testid="no-open-findings">
          <StatusGlyph meaning="pass" />
          No open failing findings
        </p>
      </section>
    )
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
      <p className="text-sm text-muted-foreground">
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
        <p className="text-sm">{worst.why}</p>
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
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          {worst.fix.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>
      <p className="text-sm">
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
            Open finding
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
      <h2 className="text-sm font-medium">Tags seen</h2>
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
  withoutAccepted,
  incomplete,
  evaluated,
  totalRuns,
  scope,
  triage,
  auditId,
  worst,
}: {
  score: Scored
  withoutAccepted: number | null
  incomplete: boolean
  evaluated: number
  totalRuns: number
  scope: string
  triage: Overview["triage"]
  auditId: string
  worst: Overview["worst"]
}) {
  const { uncertainty } = score
  return (
    <section aria-label="Score" className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <p
          className={cn(
            "text-2xl font-semibold tabular-nums",
            incomplete && "text-muted-foreground",
          )}
          data-testid="score"
        >
          {score.score}
          <span className="text-sm font-normal text-muted-foreground"> / 100</span>
        </p>
        <p className="flex items-center gap-2 text-sm font-medium" data-testid="band">
          {incomplete ? (
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
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              <Info aria-hidden="true" />
              How this is scored
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="max-h-[min(36rem,80svh)] w-[min(30rem,calc(100vw-2rem))] space-y-3 overflow-y-auto text-sm focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <Arithmetic score={score} scope={scope} />
          </PopoverContent>
        </Popover>
      </div>
      <TriageNote triage={triage} score={score.score} withoutAccepted={withoutAccepted} />
      {worst === null ? null : (
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm"
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
      <ul className="space-y-1.5 text-sm">
        {score.coverage === "partial" ? (
          <li className="flex items-start gap-2" data-testid="partly-evaluated">
            <StatusGlyph meaning="partial" className="mt-0.5" />
            Partly evaluated: {evaluated} of {totalRuns} runs have check results
          </li>
        ) : null}
        {uncertainty.checks > 0 ? (
          <li data-testid="unresolved-checks">
            <Collapsible>
              <CollapsibleTrigger
                className={cn(
                  "group flex min-h-8 items-start gap-2 rounded-md text-left",
                  focusRing,
                )}
              >
                <StatusGlyph meaning="could-not-check" className="mt-0.5" />
                <span>
                  Could not check: {count(uncertainty.rules, "rule")}, on{" "}
                  {count(uncertainty.runs, "run")}
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
                />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ul className="mt-1 list-disc space-y-0.5 pl-9 text-muted-foreground">
                  {uncertainty.ruleTitles.map((title) => (
                    <li key={title}>{title}</li>
                  ))}
                </ul>
              </CollapsibleContent>
            </Collapsible>
          </li>
        ) : null}
        {score.coverage === "full" && score.resolution === "resolved" ? (
          <li className="flex items-start gap-2" data-testid="fully-checked">
            <StatusGlyph meaning="pass" className="mt-0.5" />
            All {count(totalRuns, "run")} evaluated, every check resolved
          </li>
        ) : null}
      </ul>
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
  const { uncertainty } = score
  const purchaseFailed = score.lines.some((l) => l.ruleId === PURCHASE_FIELDS_RULE)
  return (
    <>
      <p className="font-medium">How this is scored</p>
      <p>
        Starts at 100. Each failing check costs points, more for Critical, more when it fails on
        more pages.
      </p>
      <p className="text-muted-foreground">
        It describes what this audit ran ({scope}), not the whole site.
      </p>
      {score.lines.length === 0 ? (
        <p>No rule failed, so nothing is taken off.</p>
      ) : (
        <ul className="space-y-1.5" data-testid="score-lines">
          {score.lines.map((line) => (
            <li key={line.ruleId} className="flex items-start gap-2">
              <SeverityBadge severity={line.severity} />
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                {line.title}
                <span className="block text-xs text-muted-foreground">
                  failed on {line.failing} of {line.known} runs it could be checked on
                  {line.bannerUncertain > 0
                    ? `; ${count(line.bannerUncertain, "failing run")} ${rests(line.bannerUncertain)} on an undetected banner, counted in full`
                    : ""}
                </span>
              </span>
              <span className="tabular-nums">−{line.points.toFixed(1)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="tabular-nums" data-testid="score-sum">
        100 − {score.total.toFixed(1)} = {Math.max(0, 100 - score.total).toFixed(1)}, rounded to{" "}
        {Math.max(0, Math.round(100 - score.total))}
        {score.capped ? `, capped to ${CRITICAL_CAP} because a Critical rule failed` : ""}
      </p>
      {purchaseFailed ? (
        <p className="text-muted-foreground">
          The purchase-fields rule is known to over-trigger, and the score does not dampen a false
          Critical.
        </p>
      ) : null}
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
          <p>
            Each failing rule costs its weight ({WEIGHT.critical} Critical, {WEIGHT.warning}{" "}
            Warning, {WEIGHT.info} Info) times 0.5 plus half the share of runs it failed on,
            counting only runs where it could be checked.
          </p>
          <p>
            A Critical failure caps the score at {CRITICAL_CAP}
            {score.lines.some((l) => l.severity === "critical") && !score.capped
              ? "; here the points already put it lower"
              : ""}
            .
          </p>
          <p>
            Checks that could not run are left out of the shares, never counted as passes, and shown
            as Could not check ({count(uncertainty.checks, "check")} on{" "}
            {count(uncertainty.runs, "run")} for {count(uncertainty.rules, "rule")}). Triage does
            not change the score. A rule that is wrong about one run still costs points.
          </p>
          <p>
            Score version {score.version}. Rules versions: {score.versions.join(", ")}.
          </p>
        </CollapsibleContent>
      </Collapsible>
    </>
  )
}

function AreaCounts({
  auditId,
  areas,
  checkedAreas,
}: {
  auditId: string
  areas: Overview["areas"]
  checkedAreas: Overview["checkedAreas"]
}) {
  const cell = (n: number, area: string, severity?: (typeof SEVERITIES)[number]) =>
    n === 0 ? (
      <span className="tabular-nums text-muted-foreground">0</span>
    ) : (
      <Link
        to="/app/audits/$auditId/findings"
        params={{ auditId }}
        search={{ area, severity }}
        className={`inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 tabular-nums underline underline-offset-4 ${focusRing}`}
      >
        {n}
      </Link>
    )
  const all = Object.entries(AREAS)
  const shown = all.filter(([area]) => areas[area] !== undefined)
  const quiet = all.filter(([area]) => areas[area] === undefined)
  const passed = quiet.filter(([area]) => (checkedAreas[area] ?? 0) > 0).map(([, label]) => label)
  const unchecked = quiet
    .filter(([area]) => (checkedAreas[area] ?? 0) === 0)
    .map(([, label]) => label)
  return (
    <section aria-label="Counts by area" className="space-y-2">
      <h2 className="text-sm font-medium">Counts by area</h2>
      {shown.length > 0 ? (
        <Table className="text-xs sm:text-sm">
          <TableHeader>
            <TableRow>
              <TableHead className="px-2 sm:px-3">Area</TableHead>
              {SEVERITIES.map((s) => (
                <TableHead key={s} className="px-2 text-right sm:px-3">
                  <span className="inline-flex items-center gap-1.5">
                    <StatusGlyph meaning={s} className="hidden sm:block" />
                    {SEVERITY_LABEL[s]}
                  </span>
                </TableHead>
              ))}
              <TableHead className="px-2 text-right sm:px-3">
                <span className="inline-flex items-center gap-1.5">
                  <StatusGlyph meaning="could-not-check" className="hidden sm:block" />
                  <span className="whitespace-normal">Could not check</span>
                </span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map(([area, label]) => {
              const found = areas[area]
              return (
                <TableRow key={area}>
                  <TableCell className="px-2 font-medium sm:px-3">{label}</TableCell>
                  {SEVERITIES.map((s) => (
                    <TableCell key={s} className="px-2 text-right sm:px-3">
                      {cell(found?.[s] ?? 0, area, s)}
                    </TableCell>
                  ))}
                  <TableCell className="px-2 text-right sm:px-3">
                    {cell(found?.couldNotCheck ?? 0, area)}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
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
