import { Link } from "@tanstack/react-router"
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react"
import { type ReactNode, useEffect, useId, useState, useSyncExternalStore } from "react"
import { StatusGlyph, type StatusMeaning } from "@/components/status-glyph"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { scenarioLabel } from "@/lib/audit-labels"
import { count } from "@/lib/format"
import {
  ALL_PAGES,
  type CellState,
  cellKey,
  cellState,
  type ColumnCell,
  consentColumnCell,
  coverageNote,
  JOURNEY_PAGE,
  type MatrixColumn,
  type MatrixView,
  observedChoices,
  OUTCOME_NOTE,
  type StateCount,
  stateLabel,
  type TagRow,
  vendorName,
} from "@/lib/tag-matrix"
import { cn } from "@/lib/utils"
import { getMatrixCell, getTagMatrix } from "@/server/matrix"

export type Matrix = Awaited<ReturnType<typeof getTagMatrix>>
type CellDetail = Awaited<ReturnType<typeof getMatrixCell>>

const COVERAGE_GLYPH: Record<string, StatusMeaning> = {
  complete: "pass",
  partial: "partial",
  none: "could-not-check",
}
const COVERAGE_WORD: Record<string, string> = {
  complete: "Complete",
  partial: "Partial",
  none: "Not captured",
}

const NARROW = "(max-width: 767px)"
const subscribeNarrow = (notify: () => void) => {
  const media = window.matchMedia(NARROW)
  media.addEventListener("change", notify)
  return () => media.removeEventListener("change", notify)
}
/** Below `md` a cell's details open in a bottom sheet; a popover would not fit the screen. */
const useNarrow = () =>
  useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia(NARROW).matches,
    () => false,
  )

const CHIPS_COLLAPSED = 4

const sum = (states: ReadonlyArray<StateCount>) => states.reduce((total, s) => total + s.hits, 0)

export function MatrixControls({
  matrix,
  mode,
  onChange,
}: {
  matrix: Matrix
  mode: MatrixView["mode"]
  onChange: (patch: Partial<MatrixView>) => void
}) {
  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
      <ControlGroup label="View">
        {matrix.viewports.length > 1 ? (
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            aria-label="Viewport"
            value={matrix.viewport}
            onValueChange={(viewport) => {
              if (viewport !== "") onChange({ viewport })
            }}
          >
            {matrix.viewports.map((viewport) => (
              <ToggleGroupItem key={viewport} value={viewport} className="capitalize">
                {viewport}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : null}
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          aria-label="Columns"
          value={matrix.by}
          onValueChange={(by) => {
            if (by === "scenario" || by === "page") onChange({ by })
          }}
        >
          <ToggleGroupItem value="scenario">By scenario</ToggleGroupItem>
          <ToggleGroupItem value="page">By page</ToggleGroupItem>
        </ToggleGroup>
      </ControlGroup>
      <ControlGroup label={matrix.by === "scenario" ? "Pages" : "Scenario"}>
        {matrix.by === "scenario" ? (
          <Select value={matrix.page} onValueChange={(page) => onChange({ page })}>
            <SelectTrigger size="sm" aria-label="Pages" className="max-w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_PAGES}>All pages</SelectItem>
              {matrix.pages.map((page) => (
                <SelectItem key={page.url} value={page.url}>
                  {page.label}
                </SelectItem>
              ))}
              {matrix.journey === null ? null : (
                <SelectItem value={JOURNEY_PAGE}>{matrix.journey}</SelectItem>
              )}
            </SelectContent>
          </Select>
        ) : (
          <Select value={matrix.scenario} onValueChange={(scenario) => onChange({ scenario })}>
            <SelectTrigger size="sm" aria-label="Scenario">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {matrix.scenarios.map((scenario) => (
                <SelectItem key={scenario} value={scenario}>
                  {scenarioLabel(scenario)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </ControlGroup>
      <ControlGroup label="Show">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          aria-label="What to show"
          value={mode}
          onValueChange={(next) => {
            if (next === "events" || next === "consent") onChange({ mode: next })
          }}
        >
          <ToggleGroupItem value="events">Events</ToggleGroupItem>
          <ToggleGroupItem value="consent">Consent state</ToggleGroupItem>
        </ToggleGroup>
      </ControlGroup>
    </div>
  )
}

function ControlGroup({ label, children }: { label: string; children: ReactNode }) {
  const id = useId()
  return (
    <div role="group" aria-labelledby={id} className="space-y-1.5">
      <p id={id} className="text-2xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

export function TagMatrixTable({
  auditId,
  matrix,
  mode,
}: {
  auditId: string
  matrix: Matrix
  mode: MatrixView["mode"]
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const toggle = (key: string) =>
    setExpanded((before) => {
      const next = new Set(before)
      if (!next.delete(key)) next.add(key)
      return next
    })
  return (
    <Table className="border-separate border-spacing-0">
      <caption className="sr-only">
        {matrix.by === "scenario" ? "Tags by scenario" : "Tags by page"}
      </caption>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="sticky left-0 z-20 min-w-44 border-b bg-background align-top">
            Tag
          </TableHead>
          {matrix.columns.map((column) => (
            <TableHead key={column.key} className="min-w-48 border-b align-top whitespace-normal">
              <ColumnHeader column={column} mode={mode} />
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {matrix.rows.map((row) => {
          const open = expanded.has(row.key)
          return (
            <TableRow key={row.key} className="hover:bg-transparent">
              <TableCell className="sticky left-0 z-10 border-b bg-background py-3 align-top whitespace-normal">
                <div className="flex items-start gap-1">
                  {mode === "events" ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0"
                      aria-expanded={open}
                      aria-label={`${open ? "Collapse" : "Expand"} ${row.destinationId}`}
                      onClick={() => toggle(row.key)}
                    >
                      <ChevronDown
                        className={cn("size-4 transition-transform", !open && "-rotate-90")}
                      />
                    </Button>
                  ) : null}
                  <div className="min-w-0 py-1.5">
                    <p className="text-xs text-muted-foreground">{vendorName(row.vendor)}</p>
                    <p className="font-mono text-sm [overflow-wrap:anywhere]">
                      {row.destinationId === "" ? "(no destination ID)" : row.destinationId}
                    </p>
                  </div>
                </div>
              </TableCell>
              {matrix.columns.map((column) => (
                <TableCell
                  key={column.key}
                  className="border-b px-1 py-2 align-top whitespace-normal"
                >
                  <MatrixCell
                    auditId={auditId}
                    matrix={matrix}
                    mode={mode}
                    row={row}
                    column={column}
                    cell={matrix.cells[cellKey(row, column)]}
                    open={open}
                  />
                </TableCell>
              ))}
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

function ColumnHeader({ column, mode }: { column: MatrixColumn; mode: MatrixView["mode"] }) {
  const { total, complete, partial, none } = column.runs
  const gaps = partial + none > 0
  return (
    <div className="space-y-1 py-1 font-normal">
      <p className="font-medium [overflow-wrap:anywhere]" title={column.pageUrl}>
        {column.label}
        {column.clickIds ? (
          <Badge variant="secondary" className="ml-1.5 align-middle">
            + click IDs
          </Badge>
        ) : null}
      </p>
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        {gaps ? <StatusGlyph meaning="partial" className="mt-0.5 size-3.5" /> : null}
        <span>
          {count(total, "run")}
          {gaps
            ? `: ${[`${complete} complete`, partial > 0 && `${partial} partial`, none > 0 && `${none} not captured`].filter((part) => part !== false).join(", ")}`
            : ""}
        </span>
      </p>
      {mode === "consent" ? (
        <>
          {Object.entries(column.outcomes).map(([outcome, n]) => (
            <p key={outcome} className="text-xs text-muted-foreground">
              {column.runs.total === 1
                ? OUTCOME_NOTE[outcome]
                : `${count(n, "run")}: ${OUTCOME_NOTE[outcome] ?? outcome}`}
            </p>
          ))}
          {column.cmps.length > 0 ? (
            <p className="text-xs text-muted-foreground">Banner: {column.cmps.join(", ")}</p>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

function EventChip({
  event,
  column,
}: {
  event: ColumnCell["events"][number]
  column: MatrixColumn
}) {
  const many = column.runs.total > 1
  let tally = ""
  if (many) tally = `${event.runs}/${column.runs.total}`
  else if (event.hits > 1) tally = `×${event.hits}`
  return (
    <span className="inline-flex min-h-5 items-center gap-1 rounded border px-1.5 font-mono text-2xs">
      {event.event}
      <span className="text-muted-foreground tabular-nums">{tally}</span>
      {many ? <span className="sr-only">runs with this event</span> : null}
    </span>
  )
}

function StateLine({ state, note }: { state: CellState; note: string | null }) {
  if (state.state === "not-captured")
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <StatusGlyph meaning="could-not-check" className="size-3.5" />
        Not captured
      </span>
    )
  if (state.state === "none-seen")
    return (
      <span className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <StatusGlyph
          meaning={state.incomplete === null ? "none" : "could-not-check"}
          className="mt-0.5 size-3.5"
        />
        <span>None seen{note === null ? "" : ` ${note}`}</span>
      </span>
    )
  return note === null ? null : <span className="text-xs text-muted-foreground">{note}</span>
}

function EventChips({
  events,
  cell,
  column,
  open,
}: {
  events: ColumnCell["events"]
  cell: ColumnCell | undefined
  column: MatrixColumn
  open: boolean
}) {
  const total = cell?.eventTotal ?? 0
  const shown = open ? events : events.slice(0, CHIPS_COLLAPSED)
  const hidden = total - shown.length
  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((event) => (
        <EventChip key={event.event} event={event} column={column} />
      ))}
      {hidden > 0 ? (
        <span className="inline-flex min-h-5 items-center px-1 text-2xs text-muted-foreground">
          +{hidden}
          {open ? " more" : ""}
        </span>
      ) : null}
    </span>
  )
}

function MatrixCell({
  auditId,
  matrix,
  mode,
  row,
  column,
  cell,
  open,
}: {
  auditId: string
  matrix: Matrix
  mode: MatrixView["mode"]
  row: TagRow
  column: MatrixColumn
  cell: ColumnCell | undefined
  open: boolean
}) {
  const state = cellState(cell, column)
  const note = coverageNote(state, column, cell)
  return (
    <CellPopover
      auditId={auditId}
      matrix={matrix}
      mode={mode}
      row={row}
      column={column}
      cell={cell}
      label={`${vendorName(row.vendor)} ${row.destinationId}, ${column.label}`}
    >
      <span className="flex w-full flex-col items-start gap-1">
        {state.state !== "fired" ? <StateLine state={state} note={note} /> : null}
        {state.state === "fired" && mode === "events" ? (
          <>
            <EventChips events={state.events} cell={cell} column={column} open={open} />
            <StateLine state={state} note={note} />
          </>
        ) : null}
        {state.state === "fired" && mode === "consent" ? (
          <ConsentCell cell={cell} column={column} vendor={row.vendor} note={note} />
        ) : null}
      </span>
    </CellPopover>
  )
}

function Bucket({
  title,
  states,
  signal,
}: {
  title: string
  states: StateCount[] | "n/a"
  signal: "google" | "none"
}) {
  return (
    <span className="block">
      <span className="block text-2xs font-medium text-muted-foreground">{title}</span>
      <BucketStates states={states} signal={signal} />
    </span>
  )
}

function BucketStates({
  states,
  signal,
}: {
  states: StateCount[] | "n/a"
  signal: "google" | "none"
}) {
  if (states === "n/a")
    return (
      <span className="block text-xs text-muted-foreground">Not applicable, no choice seen</span>
    )
  if (states.length === 0)
    return <span className="block text-xs text-muted-foreground">No hits</span>
  if (signal === "none") return <span className="block text-xs">{count(sum(states), "hit")}</span>
  return (
    <>
      {states.length > 1 ? (
        <span className="inline-flex min-h-5 items-center rounded border px-1.5 text-2xs font-medium">
          Mixed: {states.length} states
        </span>
      ) : null}
      {states.map((s) => (
        <span key={stateLabel(s)} className="block text-xs">
          {stateLabel(s)}: {count(s.hits, "hit")}
        </span>
      ))}
    </>
  )
}

function ConsentCell({
  cell,
  column,
  vendor,
  note,
}: {
  cell: ColumnCell | undefined
  column: MatrixColumn
  vendor: string
  note: string | null
}) {
  const consent = consentColumnCell(cell, column, vendor)
  const observed = observedChoices(column)
  return (
    <>
      {consent.signal === "none" ? (
        <span className="text-xs text-muted-foreground">No consent signal on these hits</span>
      ) : null}
      <Bucket
        title={observed === 0 ? "All hits (no choice seen)" : "Before the choice"}
        states={consent.before}
        signal={consent.signal}
      />
      <Bucket title="After the choice" states={consent.after} signal={consent.signal} />
      {consent.afterNotApplicable > 0 && observed > 0 ? (
        <span className="text-xs text-muted-foreground">
          Choice not seen on {count(consent.afterNotApplicable, "run")}
        </span>
      ) : null}
      {note === null ? null : <span className="text-xs text-muted-foreground">{note}</span>}
    </>
  )
}

function CellDetailBody({
  auditId,
  matrix,
  mode,
  row,
  column,
}: {
  auditId: string
  matrix: Matrix
  mode: MatrixView["mode"]
  row: TagRow
  column: MatrixColumn
}) {
  const [detail, setDetail] = useState<CellDetail | "failed" | null>(null)
  useEffect(() => {
    let current = true
    getMatrixCell({
      data: {
        auditId,
        viewport: matrix.viewport,
        by: matrix.by,
        page: matrix.page,
        scenario: matrix.scenario,
        mode,
        tagPage: 1,
        column: column.key,
        vendor: row.vendor,
        destinationId: row.destinationId,
      },
    }).then(
      (loaded) => {
        if (current) setDetail(loaded)
      },
      () => {
        if (current) setDetail("failed")
      },
    )
    return () => {
      current = false
    }
  }, [auditId, matrix.viewport, matrix.by, matrix.page, matrix.scenario, mode, column.key, row])
  if (detail === null) return <p className="text-xs text-muted-foreground">Loading…</p>
  if (detail === "failed")
    return (
      <p role="alert" className="text-xs text-destructive">
        Could not load this cell.
      </p>
    )
  return (
    <>
      {detail.events.length === 0 ? (
        <p className="text-xs text-muted-foreground">No events in this column.</p>
      ) : (
        <ul className="space-y-1" aria-label="Events">
          {detail.events.map((event) => (
            <li key={event.event} className="flex justify-between gap-3">
              <span className="font-mono text-xs [overflow-wrap:anywhere]">{event.event}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {count(event.hits, "hit")}
                {column.runs.total > 1 ? ` · ${event.runs}/${column.runs.total} runs` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
      <ul className="space-y-1 border-t pt-2" aria-label="Runs">
        {detail.perRun.map((r) => (
          <li key={r.runId} className="flex items-start justify-between gap-3">
            <span className="flex min-w-0 items-start gap-1.5 text-xs">
              <StatusGlyph
                meaning={COVERAGE_GLYPH[r.coverage] ?? "none"}
                className="mt-0.5 size-3.5"
              />
              <span className="[overflow-wrap:anywhere]">
                {r.label} <span className="text-muted-foreground">{COVERAGE_WORD[r.coverage]}</span>
              </span>
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {r.coverage === "none" ? "Not captured" : count(r.hits, "hit")}
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}

const LINK_CLASS =
  "inline-flex h-8 items-center rounded-md px-1 text-sm underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"

function HitsLinks({
  auditId,
  mode,
  row,
  column,
  cell,
}: {
  auditId: string
  mode: MatrixView["mode"]
  row: TagRow
  column: MatrixColumn
  cell: ColumnCell | undefined
}) {
  const search = (timing?: "before" | "after") => ({
    runId: column.runIds,
    vendor: row.vendor,
    destinationId: row.destinationId,
    source: "network" as const,
    timing,
  })
  if (mode === "consent" && cell?.consent !== undefined) {
    const before = sum(cell.consent.before)
    const after = sum(cell.consent.after)
    return (
      <>
        {before > 0 ? (
          <Link
            to="/app/audits/$auditId/hits"
            params={{ auditId }}
            search={search("before")}
            className={LINK_CLASS}
          >
            Open {count(before, "hit")} before the choice
          </Link>
        ) : null}
        {after > 0 ? (
          <Link
            to="/app/audits/$auditId/hits"
            params={{ auditId }}
            search={search("after")}
            className={LINK_CLASS}
          >
            Open {count(after, "hit")} after the choice
          </Link>
        ) : null}
      </>
    )
  }
  return (
    <Link
      to="/app/audits/$auditId/hits"
      params={{ auditId }}
      search={search()}
      className={LINK_CLASS}
    >
      Open in Hits
    </Link>
  )
}

function CellPopover({
  auditId,
  matrix,
  mode,
  row,
  column,
  cell,
  label,
  children,
}: {
  auditId: string
  matrix: Matrix
  mode: MatrixView["mode"]
  row: TagRow
  column: MatrixColumn
  cell: ColumnCell | undefined
  label: string
  children: React.ReactNode
}) {
  const narrow = useNarrow()
  const trigger = (
    <button
      type="button"
      aria-label={label}
      className="flex min-h-8 w-full cursor-pointer rounded-md px-2 py-1.5 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      {children}
    </button>
  )
  const detail = (
    <>
      <div
        tabIndex={0}
        role="region"
        aria-label="Cell details"
        className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <div>
          <p className="text-xs text-muted-foreground">
            {vendorName(row.vendor)} · {column.label}
          </p>
          <p className="font-mono [overflow-wrap:anywhere]">{row.destinationId}</p>
        </div>
        <CellDetailBody auditId={auditId} matrix={matrix} mode={mode} row={row} column={column} />
      </div>
      <div className="flex flex-wrap gap-x-3 border-t pt-2">
        <HitsLinks auditId={auditId} mode={mode} row={row} column={column} cell={cell} />
      </div>
    </>
  )
  if (narrow)
    return (
      <Sheet>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent side="bottom" className="max-h-[85dvh] gap-3 p-4 text-sm">
          <SheetTitle className="pr-8">Tag details</SheetTitle>
          <SheetDescription className="sr-only">
            Every event this tag fired in the column, the hits of each run, and a link to Hits.
          </SheetDescription>
          {detail}
        </SheetContent>
      </Sheet>
    )
  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={16}
        className="flex max-h-[min(60vh,var(--radix-popover-content-available-height))] w-96 max-w-[calc(100vw-2rem)] flex-col gap-3 text-sm"
      >
        {detail}
      </PopoverContent>
    </Popover>
  )
}

export function TagPager({
  matrix,
  perPage,
  onPage,
}: {
  matrix: Matrix
  perPage: number
  onPage: (tagPage: number) => void
}) {
  const first = (matrix.tagPage - 1) * perPage + 1
  const last = Math.min(matrix.tagTotal, matrix.tagPage * perPage)
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <p className="tabular-nums text-muted-foreground">
        Tags {first}–{last} of {matrix.tagTotal.toLocaleString("en")}
      </p>
      {matrix.tagPages > 1 ? (
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            disabled={matrix.tagPage <= 1}
            onClick={() => onPage(matrix.tagPage - 1)}
          >
            <ChevronLeft /> Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            disabled={matrix.tagPage >= matrix.tagPages}
            onClick={() => onPage(matrix.tagPage + 1)}
          >
            Next <ChevronRight />
          </Button>
        </div>
      ) : null}
    </div>
  )
}
