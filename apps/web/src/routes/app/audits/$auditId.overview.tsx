import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router"
import { CircleDashed, Info } from "lucide-react"
import { CopyButton } from "@/components/evidence"
import { EmptyState } from "@/components/empty-state"
import { SeverityBadge } from "@/components/severity"
import { StatusGlyph, type StatusMeaning } from "@/components/status-glyph"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
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

function OverviewScreen() {
  const { audit } = auditRoute.useLoaderData()
  const { status, score, coverage, areas, triage, bannerUncertain, worst, tags } =
    Route.useLoaderData()
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
      <ScoreBlock
        score={score}
        evaluated={coverage.evaluatedRuns}
        totalRuns={coverage.totalRuns}
        scope={scope}
        triage={triage}
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
            {count(score.uncertainty.bannerUncertainRuns, "failing consent check")} rest on an
            undetected banner
          </AlertTitle>
          <AlertDescription>
            <p>{BANNER_NOTE.summary}</p>
            <p>
              The findings keep their severity and their weight in the score.{" "}
              {bannerUncertain.map((f) => `${f.title} (${count(f.runs, "run")})`).join(", ")}.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}
      <WorstFinding auditId={audit.id} worst={worst} />
      <AreaCounts auditId={audit.id} areas={areas} />
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
          ? ` ${count(worst.bannerUncertainRuns, "failing run")} rest on an undetected banner.`
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
  evaluated,
  totalRuns,
  scope,
  triage,
}: {
  score: Scored
  evaluated: number
  totalRuns: number
  scope: string
  triage: Overview["triage"]
}) {
  const { uncertainty } = score
  return (
    <section aria-label="Score" className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <p className="text-2xl font-semibold tabular-nums" data-testid="score">
          {score.score}
          <span className="text-sm font-normal text-muted-foreground"> / 100</span>
        </p>
        <p className="flex items-center gap-2 text-sm font-medium" data-testid="band">
          <StatusGlyph meaning={BAND_GLYPH[score.band]} />
          {BAND_LABEL[score.band]}
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
      <ul className="space-y-1.5 text-sm">
        {score.coverage === "partial" ? (
          <li className="flex items-start gap-2" data-testid="partly-evaluated">
            <StatusGlyph meaning="partial" className="mt-0.5" />
            Partly evaluated: {evaluated} of {totalRuns} runs
          </li>
        ) : null}
        {score.resolution === "unresolved" ? (
          <li className="flex items-start gap-2" data-testid="unresolved-checks">
            <StatusGlyph meaning="could-not-check" className="mt-0.5" />
            <span>
              Unresolved checks:{" "}
              {[
                uncertainty.checks > 0
                  ? `${count(uncertainty.rules, "rule")} could not be checked, on ${count(uncertainty.runs, "run")}: ${uncertainty.ruleTitles.join(", ")}`
                  : null,
                uncertainty.bannerUncertainRuns > 0
                  ? `${count(uncertainty.bannerUncertainRuns, "failing consent check")} rest on an undetected banner`
                  : null,
              ]
                .filter((part) => part !== null)
                .join(". ")}
            </span>
          </li>
        ) : null}
        {score.coverage === "full" && score.resolution === "resolved" ? (
          <li className="flex items-start gap-2" data-testid="fully-checked">
            <StatusGlyph meaning="pass" className="mt-0.5" />
            All {count(totalRuns, "run")} evaluated, every check resolved
          </li>
        ) : null}
        {triage.acceptedRisk + triage.fixed > 0 ? (
          <li className="text-muted-foreground" data-testid="triage-tally">
            {triage.acceptedRisk} accepted risk, {triage.fixed} fixed. They still count in the
            score.
          </li>
        ) : null}
      </ul>
      {score.coverage === "partial" ? (
        <Alert role="status" className="border-sev-warning-border bg-sev-warning-bg">
          <AlertDescription className="text-foreground">
            {count(totalRuns - evaluated, "run")} of this audit{" "}
            {totalRuns - evaluated === 1 ? "has" : "have"} no check results, so what follows may be
            incomplete.
          </AlertDescription>
        </Alert>
      ) : null}
    </section>
  )
}

function Arithmetic({ score, scope }: { score: Scored; scope: string }) {
  const { uncertainty } = score
  return (
    <>
      <p className="font-medium">How this is scored (score version {score.version})</p>
      <p className="text-muted-foreground">
        The score describes what this audit ran ({scope}), not the whole site. It starts at 100.
        Each failing rule costs its weight ({WEIGHT.critical} Critical, {WEIGHT.warning} Warning,{" "}
        {WEIGHT.info} Info) times 0.5 plus half the share of runs it failed on, counting only runs
        where it could be checked.
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
                    ? `; ${count(line.bannerUncertain, "failing run")} rest on an undetected banner, counted in full`
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
      {score.lines.some((l) => l.severity === "critical") && !score.capped ? (
        <p className="text-muted-foreground">
          A Critical failure caps the score at {CRITICAL_CAP}; here the points already put it lower.
        </p>
      ) : null}
      <p className="text-muted-foreground">
        Not scored: checks that could not run are left out of the shares, never counted as passes,
        and shown as unresolved ({count(uncertainty.checks, "check")} on{" "}
        {count(uncertainty.runs, "run")} for {count(uncertainty.rules, "rule")}). Triage does not
        change the score. A rule that is wrong about one run still costs points, and the cap does
        not dampen a false Critical (the purchase-fields rule is known to over-trigger). The number
        matters less than the findings and the coverage line.
      </p>
      <p className="text-xs text-muted-foreground">Rules versions: {score.versions.join(", ")}</p>
    </>
  )
}

function AreaCounts({ auditId, areas }: { auditId: string; areas: Overview["areas"] }) {
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
  return (
    <section aria-label="Counts by area" className="space-y-2">
      <h2 className="text-sm font-medium">Counts by area</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Area</TableHead>
            {SEVERITIES.map((s) => (
              <TableHead key={s} className="text-right">
                <span className="inline-flex items-center gap-1.5">
                  <StatusGlyph meaning={s} />
                  {SEVERITY_LABEL[s]}
                </span>
              </TableHead>
            ))}
            <TableHead className="text-right">
              <span className="inline-flex items-center gap-1.5">
                <StatusGlyph meaning="could-not-check" />
                Could not check
              </span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Object.entries(AREAS).map(([area, label]) => {
            const found = areas[area]
            return (
              <TableRow key={area}>
                <TableCell className="font-medium">{label}</TableCell>
                {SEVERITIES.map((s) => (
                  <TableCell key={s} className="text-right">
                    {cell(found?.[s] ?? 0, area, s)}
                  </TableCell>
                ))}
                <TableCell className="text-right">
                  {cell(found?.couldNotCheck ?? 0, area)}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">
        Failing rules per area, accepted and fixed ones included. Could not check counts rules.
      </p>
    </section>
  )
}
