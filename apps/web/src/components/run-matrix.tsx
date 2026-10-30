import { useState } from "react"
import type { getAudit } from "@/server/audits"
import { RunPath } from "@/components/evidence"
import { StatusBadge, toBadgeStatus } from "@/components/status-badge"
import { Badge } from "@/components/ui/badge"
import { StatusGlyph } from "@/components/status-glyph"
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { runPage, runReason, runMeaning, runDuration, scenarioLabel } from "@/lib/audit-labels"
import { runPageLabel } from "@/lib/page-label"
import { duration, count } from "@/lib/format"
import { selectableRow } from "@/lib/row-style"
import { cn } from "@/lib/utils"

export type AuditRun = Awaited<ReturnType<typeof getAudit>>["runs"][number]

const SEVERITY_WORD = { critical: "Critical", warning: "Warning", info: "Info" } as const

/** "Complete" reads as "passed"; a run only says the page was recorded. */
/** Runs of a re-check that were executed but are not results: the banner check and the extras. */
export function RunRoleBadge({ role }: { role: string }) {
  if (role === "target") return null
  return <Badge variant="outline">{role === "companion" ? "Banner check" : "Extra"}</Badge>
}

export function RunStatusBadge({ status }: { status: string }) {
  if (status !== "complete") return <StatusBadge status={toBadgeStatus(status)} />
  return (
    <Badge variant="secondary" className="gap-1.5 bg-muted text-muted-foreground">
      <StatusGlyph meaning="captured" />
      Captured
    </Badge>
  )
}

const failingText = (run: AuditRun) =>
  run.failing === null
    ? null
    : `${count(run.failing.count, "failing check")}, worst ${SEVERITY_WORD[run.failing.severity]}`

const LEGEND = [
  ["captured", "Captured"],
  ["queued", "Queued"],
  ["running", "Running"],
  ["partial", "Partial"],
  ["failed", "Failed"],
  ["critical", "Critical failing"],
  ["warning", "Warning failing"],
  ["info", "Info failing"],
] as const

function MatrixLegend({ runs }: { runs: AuditRun[] }) {
  const present = new Set<string>(runs.map((run) => runMeaning(run.status)))
  for (const run of runs) if (run.failing) present.add(run.failing.severity)
  return (
    <ul
      aria-label="Legend"
      className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
    >
      {LEGEND.filter(([meaning]) => present.has(meaning)).map(([meaning, word]) => (
        <li key={meaning} className="flex items-center gap-1.5">
          <StatusGlyph meaning={meaning} />
          {word}
        </li>
      ))}
    </ul>
  )
}

export function RunMatrix({
  runs,
  view,
  selectedId,
  onSelect,
}: {
  runs: AuditRun[]
  view: "matrix" | "list" | "thumbnails"
  selectedId: string | undefined
  onSelect: (id: string) => void
}) {
  if (view === "thumbnails")
    return (
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
        {runs.map((run) => (
          <li key={run.id}>
            <button
              type="button"
              onClick={() => onSelect(run.id)}
              aria-current={run.id === selectedId ? "true" : undefined}
              className={cn(
                "flex w-full flex-col gap-2 rounded-lg border bg-card p-3 text-left text-sm transition-colors duration-150 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
                run.id === selectedId && "border-primary bg-accent hover:bg-accent",
              )}
            >
              <RunPath run={run} className="max-w-full text-xs" />
              <RunStatusBadge status={run.status} />
              <RunRoleBadge role={run.role} />
              <span>
                {scenarioLabel(run.scenario)} · {run.viewport}
              </span>
              <RunImage run={run} />
              <span className="font-mono tabular-nums">{run.hitCount} hits</span>
              {run.failing ? (
                <span className="flex items-center gap-1.5">
                  <StatusGlyph meaning={run.failing.severity} />
                  {failingText(run)}
                </span>
              ) : null}
              <span>{runReason(run)}</span>
            </button>
          </li>
        ))}
      </ul>
    )
  if (view === "list")
    return (
      <Table>
        <TableHeader>
          <TableRow>
            {[
              "Page",
              "Scenario",
              "Viewport",
              "Status",
              "Failing",
              "Hits",
              "Duration",
              "Reason",
            ].map((label) => (
              <TableHead key={label}>{label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => (
            <TableRow
              key={run.id}
              data-selected={run.id === selectedId}
              onClick={() => onSelect(run.id)}
              className={selectableRow}
            >
              <TableCell>
                <button
                  type="button"
                  className="min-h-8 max-w-64 text-left text-xs underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
                >
                  <RunPath run={run} />
                </button>
              </TableCell>
              <TableCell>{scenarioLabel(run.scenario)}</TableCell>
              <TableCell>{run.viewport}</TableCell>
              <TableCell>
                <RunStatusBadge status={run.status} />
                <RunRoleBadge role={run.role} />
              </TableCell>
              <TableCell>
                {run.failing ? (
                  <span className="inline-flex items-center gap-1.5">
                    <StatusGlyph meaning={run.failing.severity} />
                    {failingText(run)}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="font-mono tabular-nums">{run.hitCount}</TableCell>
              <TableCell className="font-mono tabular-nums">
                {runDuration(run) === null ? "—" : duration(runDuration(run) ?? 0)}
              </TableCell>
              <TableCell>{runReason(run)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )
  const pageKey = (run: AuditRun) => `${run.pageUrl}\0${run.journey}\0${run.followHost ?? ""}`
  const pages = [...new Map(runs.map((run) => [pageKey(run), run])).values()]
  const countOf = (label: (run: AuditRun) => string, run: AuditRun) =>
    pages.filter((other) => label(other) === label(run)).length
  const withHost = (run: AuditRun) => `${new URL(run.pageUrl).host}${runPage(run)}`
  const withUrl = (run: AuditRun) => {
    if (run.followHost !== null) return `Journey from ${run.pageUrl}, then ${run.followHost}`
    return run.journey ? `Journey from ${run.pageUrl}` : run.pageUrl
  }
  const pageLabel = (run: AuditRun) => {
    if (countOf(runPageLabel, run) === 1) return runPageLabel(run)
    if (countOf(runPage, run) === 1) return runPage(run)
    return countOf(withHost, run) === 1 ? withHost(run) : withUrl(run)
  }
  const viewports = [...new Set(runs.map((run) => run.viewport))]
  const scenarios = [...new Set(runs.map((run) => run.scenario))]
  const cells = new Map(
    runs.map((run) => [`${pageKey(run)}\0${run.viewport}\0${run.scenario}`, run]),
  )
  return (
    <div className="space-y-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead rowSpan={2} className="sticky left-0 z-10 min-w-40 bg-background">
              Page
            </TableHead>
            {viewports.map((viewport) => (
              <TableHead
                key={viewport}
                colSpan={scenarios.length}
                className="text-center capitalize"
              >
                {viewport}
              </TableHead>
            ))}
          </TableRow>
          <TableRow>
            {viewports.flatMap((viewport) =>
              scenarios.map((scenario) => (
                <TableHead key={`${viewport}-${scenario}`} className="min-w-32 text-center">
                  {scenarioLabel(scenario)}
                </TableHead>
              )),
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {pages.map((pageRun) => {
            const page = pageLabel(pageRun)
            return (
              <TableRow key={pageKey(pageRun)}>
                <TableCell
                  className="sticky left-0 z-10 max-w-64 truncate bg-background font-mono text-xs"
                  title={page}
                >
                  {page}
                </TableCell>
                {viewports.flatMap((viewport) =>
                  scenarios.map((scenario) => {
                    const run = cells.get(`${pageKey(pageRun)}\0${viewport}\0${scenario}`)
                    return (
                      <TableCell key={`${viewport}-${scenario}`} className="p-1 text-center">
                        {run ? (
                          <MatrixCell
                            run={run}
                            page={page}
                            scenario={scenario}
                            viewport={viewport}
                            selected={run.id === selectedId}
                            sheetOpen={selectedId !== undefined}
                            onSelect={onSelect}
                          />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    )
                  }),
                )}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">
        <StatusGlyph meaning="captured" className="mr-1 inline align-text-bottom" />
        Captured means the page was loaded and recorded. Open Findings for pass or fail. A cell
        shows the worst failing severity with its number of failing checks, then the hits.
      </p>
      <MatrixLegend runs={runs} />
    </div>
  )
}

export function RunImage({ run }: { run: AuditRun }) {
  return (
    <div
      className={
        run.viewport === "mobile"
          ? "mx-auto aspect-[390/844] w-full max-w-64 overflow-hidden rounded-md border bg-muted"
          : "aspect-[1366/768] w-full overflow-hidden rounded-md border bg-muted"
      }
    >
      {run.screenshotUrl ? (
        <img
          src={run.screenshotUrl}
          alt={`${runPage(run)}, ${scenarioLabel(run.scenario)}, ${run.viewport}`}
          loading="lazy"
          className="size-full object-contain object-top"
        />
      ) : (
        <p className="p-3 text-xs text-muted-foreground">Screenshot not available yet.</p>
      )}
    </div>
  )
}

function MatrixCell({
  run,
  page,
  scenario,
  viewport,
  selected,
  sheetOpen,
  onSelect,
}: {
  run: AuditRun
  page: string
  scenario: string
  viewport: string
  selected: boolean
  sheetOpen: boolean
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const settled = run.status !== "pending" && run.status !== "running"
  const statusWord = { pending: "Queued", complete: "Captured" }[run.status] ?? run.status
  const hits = settled ? `${run.hitCount} hits` : "—"
  return (
    <HoverCard open={open} onOpenChange={(next) => setOpen(next && !sheetOpen)}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            onSelect(run.id)
          }}
          aria-label={`${page}, ${scenarioLabel(scenario)}, ${viewport}: ${statusWord}, ${hits}${run.failing ? `, ${failingText(run)}` : ""}`}
          aria-current={selected ? "true" : undefined}
          className={cn(
            "inline-flex h-8 min-w-28 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 transition-colors duration-150 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none",
            selected && "bg-accent shadow-[inset_2px_0_0_var(--primary)] hover:bg-accent",
          )}
        >
          {run.failing && run.status === "complete" ? null : (
            <StatusGlyph meaning={runMeaning(run.status)} />
          )}
          {run.failing ? (
            <>
              <StatusGlyph meaning={run.failing.severity} />
              <span className="font-mono text-xs font-medium tabular-nums">
                {run.failing.count}
              </span>
            </>
          ) : null}
          <span
            className={cn(
              "font-mono text-xs tabular-nums",
              run.failing ? "text-muted-foreground" : "",
              run.status === "complete" && run.hitCount === 0 && "font-medium text-sev-warning",
            )}
          >
            {settled ? `${run.failing ? "· " : ""}${count(run.hitCount, "hit")}` : "—"}
          </span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent>
        <RunStatusBadge status={run.status} />
        <RunRoleBadge role={run.role} />
        <div className="my-2">
          <RunImage run={run} />
        </div>
        {run.failing ? <p className="text-xs">{failingText(run)}</p> : null}
        <p className="text-xs">
          {runReason(run) ??
            (run.status === "complete" && run.hitCount === 0
              ? "Loaded, but no tracking requests were seen. Check that this is the page you meant."
              : `${run.hitCount} hits`)}
        </p>
      </HoverCardContent>
    </HoverCard>
  )
}
