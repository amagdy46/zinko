import { useSyncExternalStore, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { StatusGlyph } from "@/components/status-glyph"
import { ScoreChip } from "@/components/score-figure"
import { StatusBadge, toBadgeStatus } from "@/components/status-badge"
import { RelativeTime } from "@/components/relative-time"
import { count } from "@/lib/format"
import type { Band, ScoreCoverage } from "@/lib/health-score"

type Result = {
  createdAt: Date | string
  status: string
  coverage: "full" | "partial" | "not-evaluated"
  couldNotCheck: number
  incompleteRuns: number
  score: number | null
  band: Band | null
  scoreCoverage: ScoreCoverage
  sites: number
  runs: number
  openFindings: { critical: number; warning: number; info: number }
}

const runningLabel = (running: number, hasFinished: boolean) => {
  if (running > 1) return `${running} audits running`
  return hasFinished ? "New audit running" : "First audit running"
}

/** The score of the last finished audit as a chip; a client's is the lowest of its sites'. */
export function LatestScore({ latest }: { latest: Result | null }) {
  if (latest === null)
    return (
      <span className="text-muted-foreground">
        —<span className="sr-only">Not audited</span>
      </span>
    )
  return (
    <div className="space-y-1">
      <ScoreChip score={latest.score} band={latest.band} coverage={latest.scoreCoverage} />
      {latest.sites > 1 && latest.score !== null ? (
        <p className="text-2xs text-muted-foreground">Lowest of {latest.sites} sites</p>
      ) : null}
    </div>
  )
}

/** The last finished audit leads; an audit still running is a separate, smaller line so it never reads as the finished one. */
export function LastAudit({ latest, running }: { latest: Result | null; running: number }) {
  return (
    <div className="space-y-1 text-xs">
      {latest ? (
        <>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {latest.status === "complete" ? null : (
              <StatusBadge status={toBadgeStatus(latest.status)} />
            )}
            <RelativeTime date={latest.createdAt} className="text-muted-foreground" />
          </div>
          {latest.incompleteRuns > 0 && latest.score === null ? (
            <p className="text-muted-foreground">
              {count(latest.incompleteRuns, "run")} could not finish
            </p>
          ) : null}
        </>
      ) : (
        <span className="text-muted-foreground">Not audited</span>
      )}
      {running > 0 ? (
        <p className="flex items-center gap-1.5 text-muted-foreground">
          <StatusGlyph meaning="running" />
          {runningLabel(running, latest !== null)}
        </p>
      ) : null}
    </div>
  )
}

const severityLabel = { critical: "Critical", warning: "Warning", info: "Info" } as const

const gap = (latest: Result) =>
  latest.couldNotCheck > 0
    ? `${count(latest.couldNotCheck, "rule")} could not be checked`
    : "not fully checked"

function NoFindings({ latest, full }: { latest: Result; full: boolean }) {
  if (latest.coverage === "not-evaluated") {
    return <span className="text-muted-foreground">Not evaluated</span>
  }
  return (
    <span className="flex items-center gap-1.5">
      <StatusGlyph meaning={full ? "pass" : "could-not-check"} />
      {full ? "No open findings" : `0 open · ${gap(latest)}`}
    </span>
  )
}

export function OpenFindings({ latest }: { latest: Result | null }) {
  if (latest === null)
    return (
      <span className="text-muted-foreground">
        —<span className="sr-only">No audit to count findings from</span>
      </span>
    )
  const total = Object.values(latest.openFindings).reduce((sum, n) => sum + n, 0)
  const full = latest.coverage === "full" && latest.couldNotCheck === 0
  return (
    <div className="space-y-1 text-xs">
      {total > 0 ? (
        <FindingCounts counts={latest.openFindings} />
      ) : (
        <NoFindings latest={latest} full={full} />
      )}
      {total > 0 && !full ? (
        <p className="text-muted-foreground">
          {latest.coverage === "not-evaluated"
            ? "Not evaluated on every site"
            : gap(latest).replace(/^./, (c) => c.toUpperCase())}
        </p>
      ) : null}
    </div>
  )
}

export function FindingCounts({
  counts,
}: {
  counts: { critical: number; warning: number; info: number; couldNotCheck?: number }
}) {
  const shown = (["critical", "warning", "info"] as const).filter(
    (severity) => counts[severity] > 0,
  )
  const unchecked = counts.couldNotCheck !== undefined && counts.couldNotCheck > 0
  if (shown.length === 0 && !unchecked)
    return <span className="text-xs text-muted-foreground">No open findings</span>
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums">
      {shown.map((severity) => (
        <span key={severity} className="inline-flex items-center gap-1">
          <StatusGlyph meaning={severity} />
          {counts[severity]} {severityLabel[severity]}
        </span>
      ))}
      {unchecked ? (
        <span className="inline-flex items-center gap-1">
          <StatusGlyph meaning="could-not-check" />
          {counts.couldNotCheck} could not check
        </span>
      ) : null}
    </div>
  )
}

const DISMISS_EVENT = "zinko:first-run-dismissed"

const subscribeDismissed = (onChange: () => void) => {
  window.addEventListener(DISMISS_EVENT, onChange)
  window.addEventListener("storage", onChange)
  return () => {
    window.removeEventListener(DISMISS_EVENT, onChange)
    window.removeEventListener("storage", onChange)
  }
}

export function FirstRun({
  organizationId,
  steps,
  next,
}: {
  organizationId: string
  steps: readonly { label: string; done: boolean }[]
  /** The link that does the first pending step. */
  next?: ReactNode
}) {
  const key = `zinko:first-run:v1:${organizationId}`
  const dismissed = useSyncExternalStore(
    subscribeDismissed,
    () => localStorage.getItem(key) === "dismissed",
    () => true,
  )
  if (steps.every((step) => step.done) || dismissed) return null
  return (
    <section className="space-y-3 rounded-lg border p-4" aria-label="Getting started">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium">Your first audit</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            localStorage.setItem(key, "dismissed")
            window.dispatchEvent(new Event(DISMISS_EVENT))
          }}
        >
          Dismiss
        </Button>
      </div>
      <ol className="grid gap-3 sm:grid-cols-3">
        {steps.map(({ label, done }, i) => (
          <li key={label} className="flex items-center gap-2 text-sm">
            <StatusGlyph meaning={done ? "pass" : "queued"} />
            <span className="text-muted-foreground">{i + 1}.</span>
            {label}
            <span className="sr-only">{done ? "Complete" : "Pending"}</span>
          </li>
        ))}
      </ol>
      {next}
    </section>
  )
}
