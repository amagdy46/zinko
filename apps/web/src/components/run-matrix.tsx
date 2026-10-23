import { useState } from "react"
import type { getAudit } from "@/server/audits"
import { StatusBadge } from "@/components/status-badge"
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
import { duration } from "@/lib/format"

export type AuditRun = Awaited<ReturnType<typeof getAudit>>["runs"][number]

export function RunMatrix({
  runs,
  view,
  sheetOpen,
  onSelect,
}: {
  runs: AuditRun[]
  view: "matrix" | "list" | "thumbnails"
  sheetOpen: boolean
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
              className="flex w-full flex-col gap-2 rounded-lg border bg-card p-3 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="max-w-full truncate font-mono text-xs">{runPage(run)}</span>
              <StatusBadge status={run.status} />
              <span>
                {scenarioLabel(run.scenario)} · {run.viewport}
              </span>
              <RunImage run={run} />
              <span className="font-mono tabular-nums">{run.hitCount} hits</span>
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
            {["Page", "Scenario", "Viewport", "Status", "Hits", "Duration", "Reason"].map(
              (label) => (
                <TableHead key={label}>{label}</TableHead>
              ),
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => (
            <TableRow key={run.id}>
              <TableCell>
                <button
                  type="button"
                  onClick={() => onSelect(run.id)}
                  className="min-h-8 max-w-64 truncate text-left font-mono text-xs underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {runPage(run)}
                </button>
              </TableCell>
              <TableCell>{scenarioLabel(run.scenario)}</TableCell>
              <TableCell>{run.viewport}</TableCell>
              <TableCell>
                <StatusBadge status={run.status} />
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
  const pageKey = (run: AuditRun) => `${run.pageUrl}\0${run.journey}`
  const pages = [...new Map(runs.map((run) => [pageKey(run), run])).values()]
  const count = (label: (run: AuditRun) => string, run: AuditRun) =>
    pages.filter((other) => label(other) === label(run)).length
  const withHost = (run: AuditRun) => `${new URL(run.pageUrl).host}${runPage(run)}`
  const withUrl = (run: AuditRun) => (run.journey ? `Journey from ${run.pageUrl}` : run.pageUrl)
  const pageLabel = (run: AuditRun) => {
    if (count(runPage, run) === 1) return runPage(run)
    return count(withHost, run) === 1 ? withHost(run) : withUrl(run)
  }
  const viewports = [...new Set(runs.map((run) => run.viewport))]
  const scenarios = [...new Set(runs.map((run) => run.scenario))]
  const cells = new Map(
    runs.map((run) => [`${pageKey(run)}\0${run.viewport}\0${run.scenario}`, run]),
  )
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead rowSpan={2} className="sticky left-0 z-10 min-w-40 bg-background">
            Page
          </TableHead>
          {viewports.map((viewport) => (
            <TableHead key={viewport} colSpan={scenarios.length} className="text-center capitalize">
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
                          sheetOpen={sheetOpen}
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
  sheetOpen,
  onSelect,
}: {
  run: AuditRun
  page: string
  scenario: string
  viewport: string
  sheetOpen: boolean
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <HoverCard open={open} onOpenChange={(next) => setOpen(next && !sheetOpen)}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            onSelect(run.id)
          }}
          aria-label={`${page}, ${scenarioLabel(scenario)}, ${viewport}: ${run.status === "pending" ? "Queued" : run.status}, ${run.hitCount} hits`}
          className="inline-flex h-8 min-w-20 items-center justify-center gap-2 rounded-md px-2 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <StatusGlyph meaning={runMeaning(run.status)} />
          <span className="font-mono text-xs tabular-nums">
            {run.status === "pending" || run.status === "running" ? "—" : run.hitCount}
          </span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent>
        <StatusBadge status={run.status} />
        <div className="my-2">
          <RunImage run={run} />
        </div>
        <p className="text-xs">{runReason(run) ?? `${run.hitCount} hits`}</p>
      </HoverCardContent>
    </HoverCard>
  )
}
