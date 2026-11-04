import { useEffect, useState } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { count } from "@/lib/format"
import { vendorName, vendorRank } from "@/lib/tag-matrix"
import { cn } from "@/lib/utils"
import type { getFinding } from "@/server/findings"
import { getProofTimeline } from "@/server/proof-timeline"

type Timeline = Awaited<ReturnType<typeof getProofTimeline>>
type Row = Timeline["rows"][number]
type Severity = Awaited<ReturnType<typeof getFinding>>["finding"]["severity"]

const MAX_ROWS = 8

const CITED_TICK: Record<Severity, string> = {
  critical: "fill-sev-critical-solid",
  warning: "fill-sev-warning-solid",
  info: "fill-sev-info-solid",
}
const CITED_TEXT: Record<Severity, string> = {
  critical: "fill-sev-critical",
  warning: "fill-sev-warning",
  info: "fill-sev-info",
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`

/** The step of the axis: about five labels, on a round number of seconds. */
const axisOf = (end: number) => {
  const step = [1, 2, 5, 10, 15, 30, 60, 120].find((s) => s * 5 * 1000 >= end) ?? 300
  return Array.from({ length: Math.floor(end / (step * 1000)) + 1 }, (_, i) => i * step)
}

const CHOICE_WORD: Partial<Record<NonNullable<Timeline["outcome"]>, string>> = {
  accepted: "Accepted",
  rejected: "Rejected",
  "not-applied": "Choice not confirmed",
}

const nameOf = (row: Row) => (row.kind === "vendor" ? vendorName(row.name) : row.name)

const uncited = (row: Row) => (row.ticks.some((t) => t.cited) ? 0 : 1)

const citedFirst = (rows: ReadonlyArray<Row>) =>
  rows.toSorted((a, b) => uncited(a) - uncited(b) || vendorRank(a.name) - vendorRank(b.name))

function Chart({ timeline, severity }: { timeline: Timeline; severity: Severity }) {
  const { rows, actionAt, outcome } = timeline
  const times = rows.flatMap((row) => row.ticks.map((t) => t.at))
  const end = Math.max(1000, actionAt ?? 0, ...times) * 1.05
  const percent = (at: number) => (at / end) * 100
  const ordered = citedFirst(rows)
  const shown = ordered.slice(0, MAX_ROWS)
  const word = outcome === null ? undefined : CHOICE_WORD[outcome]
  // the line is the visitor's choice only when one was made; a run without one has no before
  const choice = word !== undefined && actionAt !== null ? percent(actionAt) : null
  const settled = outcome === "accepted" || outcome === "rejected"
  return (
    <div aria-hidden="true" className="min-w-0 text-xs">
      {choice === null ? null : (
        <div className="grid grid-cols-[7.5rem_minmax(0,1fr)]">
          <span />
          <svg className="h-5 w-full overflow-visible">
            <text
              x={`${choice}%`}
              y="14"
              textAnchor={choice > 70 ? "end" : "middle"}
              className="fill-foreground text-xs font-semibold"
            >
              {word}
            </text>
          </svg>
        </div>
      )}
      {shown.map((row) => {
        const labelled = row.ticks.find((t) => t.cited)
        return (
          <div
            key={`${row.kind}-${row.name}`}
            className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center"
          >
            <span className="truncate pr-2 text-muted-foreground" title={nameOf(row)}>
              {nameOf(row)}
            </span>
            <svg className="h-8 w-full overflow-visible border-b border-border-subtle">
              {choice !== null && settled ? (
                <rect width={`${choice}%`} height="100%" className="fill-muted" />
              ) : null}
              {row.ticks
                .filter((t) => !t.cited)
                .map((t) => (
                  <rect
                    key={t.id}
                    x={`${percent(t.at)}%`}
                    y="9"
                    width="4"
                    height="14"
                    rx="1"
                    className="fill-muted-foreground/60"
                  />
                ))}
              {row.ticks
                .filter((t) => t.cited)
                .map((t) => (
                  <rect
                    key={t.id}
                    x={`${percent(t.at)}%`}
                    y="5"
                    width="7"
                    height="22"
                    rx="1.5"
                    className={CITED_TICK[severity]}
                  />
                ))}
              {choice === null ? null : (
                <rect
                  x={`${choice}%`}
                  width="2"
                  height="100%"
                  className={cn("fill-foreground", !settled && "opacity-50")}
                />
              )}
              {labelled === undefined ? null : (
                <text
                  x={`${percent(labelled.at)}%`}
                  dx={percent(labelled.at) > 65 ? "-5" : "12"}
                  y="20"
                  textAnchor={percent(labelled.at) > 65 ? "end" : "start"}
                  className={cn("font-mono text-xs", CITED_TEXT[severity])}
                >
                  {labelled.label}
                </text>
              )}
            </svg>
          </div>
        )
      })}
      <div className="grid grid-cols-[7.5rem_minmax(0,1fr)]">
        <span />
        <svg className="h-6 w-full overflow-visible">
          {axisOf(end).map((s) => (
            <text
              key={s}
              x={`${percent(s * 1000)}%`}
              y="16"
              textAnchor={s === 0 ? "start" : "middle"}
              className="fill-muted-foreground font-mono text-2xs"
            >
              {s}s
            </text>
          ))}
        </svg>
      </div>
      {ordered.length > MAX_ROWS ? (
        <p className="text-muted-foreground">
          And {count(ordered.length - MAX_ROWS, "more source")} that this check does not cite.
        </p>
      ) : null}
    </div>
  )
}

/** The chart in words: what was cited, when, and on which side of the choice. */
function Words({ timeline }: { timeline: Timeline }) {
  const { rows, actionAt, outcome } = timeline
  const settled = outcome === "accepted" || outcome === "rejected"
  const side = (at: number) => {
    if (!settled || actionAt === null) return ""
    return at < actionAt ? ", before the choice" : ", after the choice"
  }
  return (
    <ul className="sr-only">
      {citedFirst(rows).map((row) => {
        const cited = row.ticks.filter((t) => t.cited)
        const rest = row.ticks.length - cited.length
        return (
          <li key={`${row.kind}-${row.name}`}>
            {nameOf(row)}:{" "}
            {cited.map((t) => `${t.label} at ${seconds(t.at)}${side(t.at)}`).join("; ")}
            {rest > 0 ? ` ${count(rest, "other hit")}.` : ""}
          </li>
        )
      })}
    </ul>
  )
}

const NO_CHOICE: Partial<Record<NonNullable<Timeline["outcome"]>, string>> = {
  none: "No choice was made in this run.",
  "not-found": "No consent banner was found in this run.",
  "not-applied":
    "The choice was tried but could not be confirmed, so before and after are unknown.",
}

function NoChoice({ outcome }: { outcome: NonNullable<Timeline["outcome"]> }) {
  const note = NO_CHOICE[outcome]
  return note === undefined ? null : <p className="text-xs text-muted-foreground">{note}</p>
}

type Loaded = { for: string; state: "ready"; value: Timeline } | { for: string; state: "failed" }

/** "What fired": one run on one line of time, with what the check cites marked. */
export function ProofTimeline({
  auditId,
  runId,
  ruleId,
  severity,
  where,
}: {
  auditId: string
  runId: string
  ruleId: string
  severity: Severity
  where: string
}) {
  const key = `${runId}\0${ruleId}`
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  useEffect(() => {
    let current = true
    getProofTimeline({ data: { auditId, runId, ruleId } }).then(
      (value) => {
        if (current) setLoaded({ for: key, state: "ready", value })
      },
      () => {
        if (current) setLoaded({ for: key, state: "failed" })
      },
    )
    return () => {
      current = false
    }
  }, [auditId, runId, ruleId, key])
  const result = loaded?.for === key ? loaded : null
  const cited =
    result?.state === "ready" && result.value.rows.some((r) => r.ticks.some((t) => t.cited))
  return (
    <section aria-label="What fired" className="space-y-2" data-testid="proof-timeline">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          What fired
        </h3>
        <span className="min-w-0 font-mono text-xs [overflow-wrap:anywhere] text-muted-foreground">
          {where}
        </span>
      </div>
      {result === null ? (
        <div role="status">
          <span className="sr-only">Loading the timeline</span>
          <Skeleton className="h-24 w-full" aria-hidden />
        </div>
      ) : null}
      {result?.state === "failed" ? (
        <p role="alert" className="text-sm text-muted-foreground">
          The timeline could not be loaded. The evidence below still stands.
        </p>
      ) : null}
      {result?.state === "ready" ? (
        <>
          {result.value.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing was recorded firing in this run.
            </p>
          ) : (
            <>
              <Chart timeline={result.value} severity={severity} />
              <Words timeline={result.value} />
            </>
          )}
          {result.value.outcome === null ? null : <NoChoice outcome={result.value.outcome} />}
          {cited || !result.value.citesPage ? null : (
            <p className="text-xs text-muted-foreground">
              This check cites the page itself, which has no moment here. See the evidence below.
            </p>
          )}
          {result.value.rows.some((row) => row.kind === "cookie") ? (
            <p className="text-xs text-muted-foreground">
              A cookie shows when it was seen, not when it was written.
            </p>
          ) : null}
          {result.value.unreadable ? (
            <p className="text-xs text-muted-foreground">
              Some of what this check cites could not be read, so it is missing here.
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
