import { Link } from "@tanstack/react-router"
import { pathLabels } from "@/lib/page-label"
import { scenarioLabel } from "@/lib/audit-labels"
import { count } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { getAudit } from "@/server/audits"
import type { listFindings } from "@/server/findings"

type Run = Awaited<ReturnType<typeof getAudit>>["runs"][number]
type Problem = Awaited<ReturnType<typeof listFindings>>["findings"][number]
type Severity = Problem["severity"]
const CELL_STATES = ["failed", "passed", "could-not-check", "not-applicable", "not-run"] as const
type CellState = (typeof CELL_STATES)[number]

/** A run with no stored result for this check says "Not run", never a pass. */
const stateOf = (status: string | undefined): CellState => {
  if (status === "fail") return "failed"
  if (status === "pass") return "passed"
  if (status === "inconclusive") return "could-not-check"
  return status === "not_applicable" ? "not-applicable" : "not-run"
}

const STATE_WORD: Record<CellState, string> = {
  failed: "Failed",
  passed: "Passed",
  "could-not-check": "Could not check",
  "not-applicable": "Does not apply",
  "not-run": "Not run",
}

const FAILED_FILL: Record<Severity, string> = {
  critical: "bg-sev-critical-solid",
  warning: "bg-sev-warning-solid",
  info: "bg-sev-info-solid",
}

const HATCH =
  "bg-[repeating-linear-gradient(135deg,var(--muted-foreground)_0_1px,transparent_1px_3px)]"

const fillOf = (state: CellState, severity: Severity) => {
  if (state === "failed") return FAILED_FILL[severity]
  if (state === "passed") return "bg-muted-foreground/25"
  if (state === "could-not-check") return "border border-muted-foreground"
  return state === "not-run" ? HATCH : "border border-dashed border-border"
}

const cellClass =
  "flex h-8 w-full items-center justify-center rounded-sm outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--background),inset_0_0_0_4px_var(--ring)]"

const pageKey = (run: Run) => `${run.pageUrl}\0${run.journey}\0${run.followHost ?? ""}`

/** Pages by choice, one set of choices per viewport. Only the runs that are results: a re-check's banner checks and extras are not. */
const layoutOf = (runs: ReadonlyArray<Run>) => {
  const results = runs.filter((run) => run.role === "target")
  const pages = [...new Map(results.map((run) => [pageKey(run), run])).values()]
  const scenarios = [...new Set(results.map((run) => run.scenario))]
  const viewports = [...new Set(results.map((run) => run.viewport))]
  const columns = viewports.flatMap((viewport) =>
    scenarios.map((scenario) => ({ viewport, scenario })),
  )
  const cell = new Map(
    results.map((run) => [`${pageKey(run)}\0${run.viewport}\0${run.scenario}`, run]),
  )
  const at = (page: Run, column: (typeof columns)[number]) =>
    cell.get(`${pageKey(page)}\0${column.viewport}\0${column.scenario}`)
  const paths = pathLabels(results.map((run) => run.pageUrl))
  const labelOf = (run: Run) => {
    const path = paths.get(run.pageUrl) ?? run.pageUrl
    if (run.followHost !== null) return `Journey from ${path}, then ${run.followHost}`
    return run.journey ? `Journey from ${path}` : path
  }
  return { pages, viewports, scenarios, columns, at, labelOf }
}

/** The same sentence on the row and in the pane: a check that could not run never reads as "0 failed". */
const summaryOf = (problem: Problem) =>
  problem.kind === "fail"
    ? `${problem.failingRuns} of ${count(problem.knownRuns, "run")}`
    : `Could not check on ${count(problem.inconclusiveRuns, "run")}`

// Past this a fingerprint is taller than its row, so the row says it in words.
const MAX_FINGERPRINT_PAGES = 5
const MAX_FINGERPRINT_COLUMNS = 12

/** The small grid at the end of a row: where a problem failed, at a glance. */
export function ProblemFingerprint({
  problem,
  runs,
}: {
  problem: Problem
  runs: ReadonlyArray<Run>
}) {
  const { pages, columns, at } = layoutOf(runs)
  const words = summaryOf(problem)
  const text = (
    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
      {problem.kind === "fail" ? (
        <>
          {problem.failingRuns} of {problem.knownRuns}
        </>
      ) : (
        "Could not check"
      )}
    </span>
  )
  if (
    pages.length === 0 ||
    pages.length > MAX_FINGERPRINT_PAGES ||
    columns.length > MAX_FINGERPRINT_COLUMNS
  )
    return (
      <span className="mt-0.5 shrink-0 text-xs tabular-nums text-muted-foreground">{words}</span>
    )
  return (
    <span className="mt-1 flex shrink-0 items-start gap-2">
      <span className="sr-only">{problem.kind === "fail" ? `Failed on ${words}` : words}</span>
      <span aria-hidden="true">{text}</span>
      <span aria-hidden="true" className="contents">
        <table className="border-separate border-spacing-0.5">
          <tbody>
            {pages.map((page) => (
              <tr key={pageKey(page)}>
                {columns.map((column) => {
                  const run = at(page, column)
                  const state = stateOf(run === undefined ? undefined : problem.outcomes[run.id])
                  return (
                    <td
                      key={`${column.viewport}-${column.scenario}`}
                      className={cn(
                        "size-1.5 rounded-[1px] p-0",
                        run === undefined ? "" : fillOf(state, problem.severity),
                      )}
                    />
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </span>
    </span>
  )
}

/** The grid of the proof pane: every page by every choice. Each cell opens its run in Evidence. */
export function ProblemGrid({
  auditId,
  problem,
  runs,
  pickable,
  selectedRunId,
  onPick,
}: {
  auditId: string
  problem: Problem
  runs: ReadonlyArray<Run>
  /** Runs this check flagged: their cell shows that run's proof here instead of opening Evidence. */
  pickable: ReadonlyArray<string>
  selectedRunId: string | undefined
  onPick: (runId: string) => void
}) {
  const { pages, viewports, scenarios, columns, at, labelOf } = layoutOf(runs)
  if (pages.length === 0) return null
  const present = new Set<CellState>(
    pages.flatMap((page) =>
      columns.flatMap((column) => {
        const run = at(page, column)
        return run === undefined ? [] : [stateOf(problem.outcomes[run.id])]
      }),
    ),
  )
  return (
    <section
      aria-label={problem.kind === "fail" ? "Where it failed" : "Where it could not be checked"}
      className="space-y-2"
      data-testid="problem-grid"
    >
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-0.5 text-xs">
          <thead>
            {viewports.length > 1 ? (
              <tr>
                <td />
                {viewports.map((viewport) => (
                  <th
                    key={viewport}
                    scope="colgroup"
                    colSpan={scenarios.length}
                    className="px-1 font-normal text-muted-foreground capitalize"
                  >
                    {viewport}
                  </th>
                ))}
              </tr>
            ) : null}
            <tr>
              <td />
              {columns.map((column) => (
                <th
                  key={`${column.viewport}-${column.scenario}`}
                  scope="col"
                  className="min-w-10 px-1 pb-1 font-normal text-muted-foreground sm:whitespace-nowrap"
                >
                  {scenarioLabel(column.scenario)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pages.map((page) => {
              const label = labelOf(page)
              return (
                <tr key={pageKey(page)}>
                  <th
                    scope="row"
                    title={label}
                    className="max-w-24 pr-2 text-left break-all sm:max-w-40 font-mono font-normal text-muted-foreground"
                  >
                    {label}
                  </th>
                  {columns.map((column) => {
                    const run = at(page, column)
                    if (run === undefined)
                      return <td key={`${column.viewport}-${column.scenario}`} />
                    const state = stateOf(problem.outcomes[run.id])
                    return (
                      <td key={`${column.viewport}-${column.scenario}`} className="p-0">
                        {pickable.includes(run.id) ? (
                          <button
                            type="button"
                            aria-pressed={run.id === selectedRunId}
                            aria-label={`${label}, ${scenarioLabel(column.scenario)}, ${column.viewport}: ${STATE_WORD[state]}. Show this run`}
                            title={STATE_WORD[state]}
                            onClick={() => onPick(run.id)}
                            className={cn(
                              cellClass,
                              fillOf(state, problem.severity),
                              "aria-pressed:outline-2 aria-pressed:outline-offset-1 aria-pressed:outline-foreground",
                            )}
                          >
                            {state === "failed" ? (
                              <span className="size-2 rotate-45 bg-background" />
                            ) : null}
                          </button>
                        ) : (
                          <Link
                            to="/app/audits/$auditId"
                            params={{ auditId }}
                            search={{ view: "matrix", run: run.id }}
                            aria-label={`${label}, ${scenarioLabel(column.scenario)}, ${column.viewport}: ${STATE_WORD[state]}. Open the run`}
                            title={STATE_WORD[state]}
                            className={cn(cellClass, fillOf(state, problem.severity))}
                          >
                            {state === "failed" ? (
                              <span className="size-2 rotate-45 bg-background" />
                            ) : null}
                          </Link>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {CELL_STATES.filter((state) => present.has(state)).map((state) => (
          <li key={state} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={cn(
                "flex size-3 items-center justify-center rounded-[2px]",
                fillOf(state, problem.severity),
              )}
            >
              {state === "failed" ? <span className="size-1.5 rotate-45 bg-background" /> : null}
            </span>
            {STATE_WORD[state]}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        {problem.kind === "fail" ? `Failed on ${summaryOf(problem)}.` : `${summaryOf(problem)}.`}
      </p>
    </section>
  )
}
