import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router"
import { Option, Schema } from "effect"
import { useEffect, useRef, useState } from "react"
import { ChevronDown, ChevronLeft, ChevronRight, Download, ListFilter } from "lucide-react"
import { ChangeGlyph } from "@/components/change-badge"
import { FindingDetail, type FindingRow, type Triage } from "@/components/finding-detail"
import { SeverityMark } from "@/components/severity"
import { FindingsSkeleton } from "@/components/page-skeleton"
import { StatusGlyph } from "@/components/status-glyph"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { auditTabTitle, type TitleContext } from "@/lib/page-title"
import { AREAS, LOCAL_ANSWER_SENTENCE } from "@/lib/audit-labels"
import { count } from "@/lib/format"
import { OWNER_LABELS } from "@/lib/report-model"
import { sharePending } from "@/lib/share-pending"
import { cn } from "@/lib/utils"
import { CHANGE_WORDS } from "@/lib/compare-text"
import type { ChangeState } from "@/lib/compare"
import { getFindingChips as fetchFindingChips } from "@/server/compare"
import { listFindings } from "@/server/findings"

const auditRoute = getRouteApi("/app/audits/$auditId")

const TRIAGES = ["open", "accepted_risk", "fixed"] as const
const TRIAGE_TABS: Record<Triage, string> = {
  open: "Open",
  accepted_risk: "Accepted risk",
  fixed: "Fixed",
}
const SEVERITIES = ["critical", "warning", "info"] as const
type Severity = (typeof SEVERITIES)[number]
const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Info",
}
const AREA_IDS = Object.keys(AREAS)

const decodeText = Schema.decodeUnknownOption(Schema.NonEmptyString)
const decodeTriage = Schema.decodeUnknownOption(Schema.Literals(TRIAGES))

/** A comma-separated list in the URL, reduced to the known values in their canonical order. */
const known = (value: unknown, allowed: ReadonlyArray<string>) => {
  if (typeof value !== "string") return undefined
  const chosen = value.split(",")
  const kept = allowed.filter((a) => chosen.includes(a))
  return kept.length === 0 ? undefined : kept.join(",")
}
const listOf = (value: string | undefined) => (value === undefined ? [] : value.split(","))

const LOCAL_ANSWER_NOTE = `${LOCAL_ANSWER_SENTENCE} Whether the vendors accepted the requests (delivery errors) is not checked, and it is not counted as passed.`

const getFindingChips = sharePending(fetchFindingChips)

type Search = { finding?: string; triage?: Triage; severity?: string; area?: string }

export const Route = createFileRoute("/app/audits/$auditId/findings")({
  head: ({ matches }: TitleContext) => auditTabTitle("Findings", matches),
  validateSearch: (search: Record<string, unknown>): Search => ({
    finding: Option.getOrUndefined(decodeText(search.finding)),
    triage: Option.getOrUndefined(decodeTriage(search.triage)),
    severity: known(search.severity, SEVERITIES),
    area: known(search.area, AREA_IDS),
  }),
  loader: ({ params }) => listFindings({ data: { auditId: params.auditId } }),
  notFoundComponent: () => <p className="text-sm text-muted-foreground">Audit not found.</p>,
  pendingComponent: FindingsSkeleton,
  component: FindingsScreen,
})

type Listing = Awaited<ReturnType<typeof listFindings>>

/** The "answered locally" limit of Zinko's own audits: expected, and never a pass. */
const isLocalLimit = (row: FindingRow) =>
  row.ruleId === "hygiene.tag-errors" &&
  row.kind === "inconclusive" &&
  /answered (tracking requests )?locally/.test(row.reason ?? "")

function useBelowLg() {
  const [below, setBelow] = useState(false)
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)")
    const update = () => setBelow(media.matches)
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])
  return below
}

interface Chip {
  state: ChangeState
  low: boolean
}

/** How each finding changed since the baseline; fetched after the list is on screen. */
function useChips(auditId: string) {
  const [chips, setChips] = useState<ReadonlyMap<string, Chip>>(new Map())
  useEffect(() => {
    let current = true
    getFindingChips({ data: { auditId } }).then(
      (found) => {
        if (current) setChips(new Map(found.map((c) => [c.ruleId, c])))
      },
      (error: unknown) => console.warn("The change chips could not be loaded", error),
    )
    return () => {
      current = false
    }
  }, [auditId])
  return chips
}

function FindingsScreen() {
  const { audit, runs } = auditRoute.useLoaderData()
  const chips = useChips(audit.id)
  const { status, coverage, findings } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const below = useBelowLg()
  const opener = useRef<HTMLElement | null>(null)
  const sheetOpen = search.finding !== undefined
  useEffect(() => {
    if (sheetOpen) return undefined
    const remember = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement) opener.current = event.target
    }
    document.addEventListener("focusin", remember)
    return () => document.removeEventListener("focusin", remember)
  }, [sheetOpen])
  const triage = search.triage ?? "open"
  const severities = listOf(search.severity)
  const areas = listOf(search.area)
  const [unchecked, setUnchecked] = useState<boolean | null>(null)
  // findings are written when the audit finishes, check results as each run is saved; the status
  // comes with the findings, not from the audit loader, which may be a moment ahead of them
  const finished = ["complete", "partial", "failed"].includes(status)
  const active = !finished

  if (coverage.evaluatedRuns === 0)
    return (
      <div className="rounded-lg border bg-card p-4 text-sm" data-testid="not-evaluated">
        <h2 className="font-medium">{active ? "Checks are still to come" : "Not evaluated"}</h2>
        <p className="mt-1 text-muted-foreground">
          {active
            ? "Each run is checked as it is saved. Findings appear here as they are written."
            : "No run of this audit has check results: it ran before Zinko checked rules, or none of its runs was saved. Nothing can be said about its tracking, and it is not clean."}
        </p>
      </div>
    )

  const failing = findings.filter((f) => f.kind === "fail")
  const couldNotCheck = findings.filter((f) => f.kind === "inconclusive")
  const inTab = failing.filter((f) => f.triage.status === triage)
  const matchesArea = (f: FindingRow) => areas.length === 0 || areas.includes(f.area)
  const matchesSeverity = (f: FindingRow) =>
    severities.length === 0 || severities.some((s) => s === f.severity)
  const visible = inTab.filter((f) => matchesArea(f) && matchesSeverity(f))
  const visibleUnchecked = triage === "open" ? couldNotCheck.filter(matchesArea) : []
  const uncheckedOpen = unchecked ?? failing.length === 0
  const ordered = [...visible, ...(uncheckedOpen ? visibleUnchecked : [])]
  const tabCount = (t: Triage) => failing.filter((f) => f.triage.status === t).length
  const explicit = findings.find((f) => f.ruleId === search.finding)
  const selected = explicit ?? (below ? undefined : ordered[0])
  const position =
    selected === undefined ? -1 : ordered.findIndex((f) => f.ruleId === selected.ruleId)
  const full = coverage.evaluatedRuns >= coverage.totalRuns && coverage.unfinishedRuns === 0
  const missing = coverage.totalRuns - coverage.evaluatedRuns
  const mixed = coverage.rulesVersions.length > 1
  const filtered = severities.length > 0 || areas.length > 0

  const go = (patch: Partial<Search>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })
  const selectFinding = (ruleId: string | undefined) => go({ finding: ruleId })
  const toggleArea = (area: string, on: boolean) => {
    const next = AREA_IDS.filter((a) => (a === area ? on : areas.includes(a)))
    go({ area: next.length === 0 ? undefined : next.join(",") })
  }
  const areaCount = (area: string) => inTab.filter((f) => f.area === area).length
  const severityCount = (severity: Severity) => inTab.filter((f) => f.severity === severity).length

  return (
    <div className="space-y-4 lg:flex lg:h-[calc(100dvh-8.5rem)] lg:flex-col">
      <Coverage
        coverage={coverage}
        full={full}
        missing={missing}
        active={active}
        mixed={mixed}
        localLimit={couldNotCheck.some(isLocalLimit)}
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div
          tabIndex={0}
          role="region"
          aria-label="Findings list"
          className="min-w-0 space-y-4 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background lg:min-h-0 lg:overflow-y-auto lg:pr-2"
        >
          <Tabs
            value={triage}
            onValueChange={(next) => go({ triage: Option.getOrUndefined(decodeTriage(next)) })}
          >
            <TabsList aria-label="Triage status">
              {TRIAGES.map((t) => (
                <TabsTrigger key={t} value={t}>
                  {TRIAGE_TABS[t]}
                  <span className="text-xs tabular-nums text-muted-foreground">{tabCount(t)}</span>
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value={triage} className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <ToggleGroup
                  type="multiple"
                  variant="outline"
                  size="sm"
                  aria-label="Severity"
                  value={severities}
                  onValueChange={(next) => go({ severity: known(next.join(","), SEVERITIES) })}
                >
                  {SEVERITIES.map((s) => (
                    <ToggleGroupItem
                      key={s}
                      value={s}
                      disabled={severityCount(s) === 0 && !severities.includes(s)}
                      className="gap-1.5"
                    >
                      <StatusGlyph meaning={s} />
                      {SEVERITY_LABEL[s]}
                      <span className="tabular-nums text-muted-foreground">{severityCount(s)}</span>
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      <ListFilter aria-hidden="true" />
                      {areas.length === 0
                        ? "Area"
                        : `Area: ${AREAS[areas[0] ?? ""] ?? areas[0]}${areas.length > 1 ? ` +${areas.length - 1}` : ""}`}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {AREA_IDS.map((area) => (
                      <DropdownMenuCheckboxItem
                        key={area}
                        checked={areas.includes(area)}
                        onSelect={(event) => event.preventDefault()}
                        onCheckedChange={(on) => toggleArea(area, on)}
                      >
                        {AREAS[area]}
                        <span className="ml-auto pl-3 tabular-nums text-muted-foreground">
                          {areaCount(area)}
                        </span>
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button asChild variant="outline" size="sm">
                  <a href={`/api/audits/${audit.id}/register.csv`} download>
                    <Download aria-hidden="true" />
                    Export CSV
                  </a>
                </Button>
                {filtered ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => go({ severity: undefined, area: undefined })}
                  >
                    Clear
                  </Button>
                ) : null}
              </div>
              {visible.length === 0 ? (
                <EmptyList
                  triage={triage}
                  filtered={filtered}
                  triagedElsewhere={failing.length - tabCount("open")}
                  noFailing={failing.length === 0}
                  finished={finished}
                  full={full}
                  evaluated={coverage.evaluatedRuns}
                  missing={missing}
                  couldNotCheck={couldNotCheck.length}
                />
              ) : (
                SEVERITIES.map((s) => {
                  const rows = visible.filter((f) => f.severity === s)
                  return rows.length === 0 ? null : (
                    <section key={s} aria-label={SEVERITY_LABEL[s]}>
                      <h2 className="sticky top-0 z-10 flex items-center gap-1.5 bg-background py-1.5 text-xs font-medium">
                        <StatusGlyph meaning={s} />
                        {SEVERITY_LABEL[s]}
                        <span aria-hidden="true" className="tabular-nums text-muted-foreground">
                          {rows.length}
                        </span>
                        <span className="sr-only">, {count(rows.length, "finding")}</span>
                      </h2>
                      <ul>
                        {rows.map((row) => (
                          <li key={row.ruleId}>
                            <FindingItem
                              row={row}
                              selected={row.ruleId === selected?.ruleId}
                              chip={chips.get(row.ruleId)}
                            />
                          </li>
                        ))}
                      </ul>
                    </section>
                  )
                })
              )}
              {visibleUnchecked.length === 0 ? null : (
                <Collapsible open={uncheckedOpen} onOpenChange={setUnchecked}>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="-ml-2">
                      <ChevronDown
                        aria-hidden="true"
                        className={cn(!uncheckedOpen && "-rotate-90")}
                      />
                      Could not check
                      <span className="tabular-nums text-muted-foreground">
                        {visibleUnchecked.length}
                      </span>
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <p className="pb-1 text-xs text-muted-foreground">
                      These checks did not run. They are not passes.
                    </p>
                    <ul>
                      {visibleUnchecked.map((row) => (
                        <li key={row.ruleId}>
                          <FindingItem
                            row={row}
                            selected={row.ruleId === selected?.ruleId}
                            chip={chips.get(row.ruleId)}
                          />
                        </li>
                      ))}
                    </ul>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </TabsContent>
          </Tabs>
          {audit.kind === "full" ? (
            <p className="pt-4 text-sm text-muted-foreground">
              Ready to send?{" "}
              <Link
                to="/app/audits/$auditId/report"
                params={{ auditId: audit.id }}
                className="inline-flex h-8 items-center rounded-md underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                Open the report
              </Link>
            </p>
          ) : null}
        </div>
        {below ? null : (
          <aside
            aria-label="Finding detail"
            tabIndex={0}
            className="overflow-hidden rounded-lg border bg-card text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background lg:min-h-0 lg:overflow-y-auto"
          >
            {selected === undefined ? (
              <p className="p-4 text-muted-foreground">Select a finding to see its evidence.</p>
            ) : (
              <FindingDetail
                key={selected.ruleId}
                auditId={audit.id}
                row={selected}
                runs={runs}
                canVerify={audit.kind === "full"}
              />
            )}
          </aside>
        )}
      </div>
      {below ? (
        <Sheet
          open={explicit !== undefined}
          onOpenChange={(open) => {
            if (!open) selectFinding(undefined)
          }}
        >
          <SheetContent
            side="bottom"
            className="max-h-[90svh] gap-0 p-0"
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              if (opener.current?.isConnected) opener.current.focus()
            }}
          >
            <SheetTitle className="sr-only">{explicit?.title ?? "Finding"}</SheetTitle>
            <SheetDescription className="sr-only">Evidence and fix steps</SheetDescription>
            <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2 pr-12">
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Previous finding"
                disabled={position < 1}
                onClick={() => selectFinding(ordered[position - 1]?.ruleId)}
              >
                <ChevronLeft />
              </Button>
              <span className="text-xs tabular-nums text-muted-foreground">
                {position < 0 ? "" : `${position + 1}/${ordered.length}`}
              </span>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Next finding"
                disabled={position < 0 || position >= ordered.length - 1}
                onClick={() => selectFinding(ordered[position + 1]?.ruleId)}
              >
                <ChevronRight />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {explicit === undefined ? null : (
                <FindingDetail
                  key={explicit.ruleId}
                  auditId={audit.id}
                  row={explicit}
                  runs={runs}
                  canVerify={audit.kind === "full"}
                />
              )}
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  )
}

function Coverage({
  coverage,
  full,
  missing,
  active,
  mixed,
  localLimit,
}: {
  coverage: Listing["coverage"]
  full: boolean
  missing: number
  active: boolean
  mixed: boolean
  localLimit: boolean
}) {
  const { runs } = coverage
  const summary = [
    runs.failing > 0 ? `${count(runs.failing, "run")} with a failing check` : null,
    runs.couldNotCheck > 0
      ? `${count(runs.couldNotCheck, "run")} with a check that could not run`
      : null,
    runs.passed > 0
      ? `${count(runs.passed, "run")} passed${coverage.passedNothingApplied > 0 ? ` (${coverage.passedNothingApplied} with nothing applied)` : ""}`
      : null,
  ].filter((line) => line !== null)
  if (full && !mixed)
    return (
      <Collapsible className="text-sm text-muted-foreground" data-testid="coverage">
        <p className="flex flex-wrap items-center gap-x-1">
          All {count(coverage.totalRuns, "run")} evaluated.
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="group/details h-8">
              <ChevronDown
                aria-hidden="true"
                className="group-data-[state=closed]/details:-rotate-90"
              />
              Details
            </Button>
          </CollapsibleTrigger>
        </p>
        <CollapsibleContent className="space-y-1 pb-1">
          <p>Runs: {summary.join(" · ")}</p>
          {localLimit ? <p>{LOCAL_ANSWER_NOTE}</p> : null}
        </CollapsibleContent>
      </Collapsible>
    )
  const segments: ReadonlyArray<{ key: string; n: number; tone: string; label: string }> = [
    {
      key: "failing",
      n: runs.failing,
      tone: "bg-sev-critical-solid",
      label: "with a failing check",
    },
    {
      key: "unsure",
      n: runs.couldNotCheck,
      tone: "bg-muted-foreground/40",
      label: "could not check",
    },
    { key: "passed", n: runs.passed, tone: "bg-status-pass-solid", label: "passed" },
    {
      key: "none",
      n: runs.notEvaluated,
      tone: "border border-dashed bg-muted",
      label: "not evaluated",
    },
  ]
  return (
    <Alert
      role="status"
      className="border-sev-warning-border bg-sev-warning-bg"
      data-testid="coverage"
    >
      <AlertTitle className="line-clamp-none">
        {coverage.completeEvaluatedRuns} of {count(coverage.totalRuns, "run")} evaluated
        {coverage.unfinishedRuns > 0 ? `; ${coverage.unfinishedRuns} did not finish` : ""}
      </AlertTitle>
      <AlertDescription className="text-foreground">
        <Collapsible className="w-full">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="-ml-2 group/details">
              <ChevronDown
                aria-hidden="true"
                className="group-data-[state=closed]/details:-rotate-90"
              />
              Details
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 pt-1">
            {missing === 0 ? null : (
              <p>
                {count(missing, "run")}{" "}
                {active
                  ? "still to be checked"
                  : `${missing === 1 ? "has" : "have"} no check results`}
                , so what follows may be incomplete.
              </p>
            )}
            {missing === 0 && coverage.unfinishedRuns > 0 ? (
              <p>
                {count(coverage.unfinishedRuns, "run")} did not finish, so their checks may be
                missing and what follows may be incomplete.
              </p>
            ) : null}
            {mixed ? (
              <p data-testid="mixed-versions">
                The runs were evaluated with different versions of the rules (
                {coverage.rulesVersions.join(", ")}). The checks and their wording can differ
                between them.
              </p>
            ) : null}
            <div className="flex h-2 w-full gap-px overflow-hidden rounded-full" aria-hidden="true">
              {segments.flatMap((segment) =>
                Array.from({ length: segment.n }, (_, i) => (
                  <span key={`${segment.key}-${i}`} className={cn("flex-1", segment.tone)} />
                )),
              )}
            </div>
            <TooltipProvider>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums">
                {segments
                  .filter((segment) => segment.n > 0)
                  .map((segment) => (
                    <li key={segment.key} className="flex items-center gap-1.5">
                      <span
                        aria-hidden="true"
                        className={cn("size-2 rounded-full", segment.tone)}
                      />
                      {segment.key === "passed" && coverage.passedNothingApplied > 0 ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              tabIndex={0}
                              className="rounded-sm underline decoration-dotted underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                            >
                              {segment.n} {segment.label}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            {coverage.passedNothingApplied} passed with nothing applied
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <span>
                          {segment.n} {segment.label}
                        </span>
                      )}
                    </li>
                  ))}
              </ul>
            </TooltipProvider>
            {localLimit ? <p className="text-xs">{LOCAL_ANSWER_NOTE}</p> : null}
            {coverage.couldNotCheckOnFailingRuns > 0 ? (
              <p className="text-xs">
                On {count(coverage.couldNotCheckOnFailingRuns, "failing run")}, one check could not
                run.
              </p>
            ) : null}
          </CollapsibleContent>
        </Collapsible>
      </AlertDescription>
    </Alert>
  )
}

function EmptyList({
  triage,
  filtered,
  triagedElsewhere,
  noFailing,
  finished,
  full,
  evaluated,
  missing,
  couldNotCheck,
}: {
  triage: Triage
  filtered: boolean
  triagedElsewhere: number
  noFailing: boolean
  finished: boolean
  full: boolean
  evaluated: number
  missing: number
  couldNotCheck: number
}) {
  if (filtered)
    return <p className="text-sm text-muted-foreground">No findings match these filters.</p>
  if (triage !== "open")
    return (
      <p className="text-sm text-muted-foreground">
        {triage === "fixed" ? "No finding is marked fixed." : "No risk has been accepted."}
      </p>
    )
  if (!noFailing)
    return (
      <p className="text-sm" data-testid="all-triaged">
        Nothing is open. {count(triagedElsewhere, "finding")}{" "}
        {triagedElsewhere === 1 ? "is" : "are"} accepted or fixed.
        {couldNotCheck > 0 || !full
          ? " This audit is not confirmed clean: some checks could not run or some runs were not evaluated."
          : ""}
      </p>
    )
  if (!finished)
    return (
      <p className="text-sm" data-testid="collecting">
        Checks are being collected. Findings are written when the audit finishes, so none are known
        yet.
      </p>
    )
  if (couldNotCheck > 0)
    return (
      <p className="text-sm" data-testid="only-inconclusive">
        Nothing failed, but {count(couldNotCheck, "check")} could not be run. This audit is not
        confirmed clean.
      </p>
    )
  if (!full)
    return (
      <p className="text-sm" data-testid="partial-clean">
        No findings were recorded for the {count(evaluated, "evaluated run")}, but{" "}
        {count(missing, "run")} could not be evaluated, so this audit is not confirmed clean.
      </p>
    )
  return (
    <p className="text-sm" data-testid="no-findings">
      No findings. All {count(evaluated, "run")} were evaluated, and every check passed or did not
      apply.
    </p>
  )
}

function FindingItem({
  row,
  selected,
  chip,
}: {
  row: FindingRow
  selected: boolean
  chip: Chip | undefined
}) {
  const failing = row.kind === "fail"
  return (
    <Link
      to="/app/audits/$auditId/findings"
      from="/app/audits/$auditId/findings"
      search={(prev) => ({ ...prev, finding: row.ruleId })}
      replace
      data-testid="finding"
      data-selected={selected}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex items-start gap-2 rounded-md px-3 py-2 text-sm outline-none transition-colors duration-150 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        failing ? SeverityMark[row.severity] : "border-l-2 border-l-transparent",
        selected && "bg-accent shadow-[inset_-2px_0_0_var(--primary)] hover:bg-accent",
      )}
    >
      {failing ? null : <StatusGlyph meaning="could-not-check" className="mt-0.5" />}
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{failing ? row.title : row.checkTitle}</span>
        <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
          <span className="truncate">
            {failing
              ? `${AREAS[row.area] ?? row.area} · ${count(row.pages, "page")} · ${count(row.scenarios, "scenario")}`
              : (row.reason ?? `${AREAS[row.area] ?? row.area} · ${count(row.pages, "page")}`)}
          </span>
          {chip === undefined ? null : (
            <span className="flex shrink-0 items-center gap-1 text-foreground">
              <ChangeGlyph state={chip.state} className="size-3" />
              {CHANGE_WORDS[chip.state]}
              {chip.low ? <span className="text-muted-foreground">(low confidence)</span> : null}
            </span>
          )}
        </span>
        {failing && row.owner !== null ? (
          <span className="block text-xs text-muted-foreground" data-testid="finding-owner">
            Usually fixed by: <span className="text-foreground">{OWNER_LABELS[row.owner]}</span>
          </span>
        ) : null}
        {failing && row.firstFix !== null ? (
          <span className="mt-0.5 block text-xs" data-testid="fix-first">
            <span className="text-muted-foreground">Fix first:</span> {row.firstFix}
          </span>
        ) : null}
        {isLocalLimit(row) ? (
          <span className="block text-xs text-muted-foreground">
            Expected: requests are answered locally
          </span>
        ) : null}
      </span>
      {failing && row.knownRuns > 0 ? (
        <span className="flex shrink-0 flex-col items-end gap-1 pt-0.5 text-xs text-muted-foreground">
          <span className="tabular-nums">
            {row.failingRuns} of {count(row.knownRuns, "run")}
          </span>
          <svg aria-hidden="true" viewBox="0 0 100 4" className="h-1 w-16">
            <rect width="100" height="4" rx="2" className="fill-muted" />
            <rect
              width={Math.min(100, (row.failingRuns / row.knownRuns) * 100)}
              height="4"
              rx="2"
              className="fill-foreground/50"
            />
          </svg>
        </span>
      ) : null}
    </Link>
  )
}
