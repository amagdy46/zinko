import { useSyncExternalStore } from "react"
import { Link } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import { StatusGlyph } from "@/components/status-glyph"
import { StatusBadge } from "@/components/status-badge"
import { count, relativeTime, useTimeZone } from "@/lib/format"

type Result = {
  createdAt: Date | string
  status: string
  coverage: "full" | "partial" | "not-evaluated"
  couldNotCheck: number
  incompleteRuns: number
  score: number | null
  sites: number
  runs: number
  openFindings: { critical: number; warning: number; info: number }
}

export function LastAudit({ latest, running }: { latest: Result | null; running: number }) {
  const timeZone = useTimeZone()
  return (
    <div className="space-y-1 text-xs">
      {running > 0 ? (
        <span className="flex items-center gap-1.5">
          <StatusGlyph meaning="running" />
          Audit running
        </span>
      ) : null}
      {latest ? (
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={latest.status} />
          <time title={relativeTime(latest.createdAt, timeZone).title}>
            {relativeTime(latest.createdAt).text}
          </time>
          {latest.score === null ? null : (
            <span className="font-medium tabular-nums">
              {latest.sites > 1 ? "Lowest " : ""}
              {latest.score}/100
              {latest.sites === 1 ? (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  from {count(latest.runs, "run")}
                </span>
              ) : null}
            </span>
          )}
        </div>
      ) : (
        <span className="text-muted-foreground">Not audited</span>
      )}
      {latest !== null && latest.incompleteRuns > 0 ? (
        <p className="text-muted-foreground">
          {count(latest.incompleteRuns, "run")} could not finish
        </p>
      ) : null}
    </div>
  )
}

const severityLabel = { critical: "Critical", warning: "Warning", info: "Info" } as const

const gap = (latest: Result) =>
  latest.couldNotCheck > 0
    ? `${count(latest.couldNotCheck, "check")} could not run`
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
  if (latest === null) return <span className="text-muted-foreground">Not audited</span>
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
  clients,
}: {
  organizationId: string
  clients: readonly { id: string; siteCount: number; running: number; latest: Result | null }[]
}) {
  const key = `zinko:first-run:v1:${organizationId}`
  const dismissed = useSyncExternalStore(
    subscribeDismissed,
    () => localStorage.getItem(key) === "dismissed",
    () => true,
  )
  const complete = [
    clients.length > 0,
    clients.some((c) => c.siteCount > 0),
    clients.some((c) => c.running > 0 || c.latest !== null),
  ]
  if (complete.every(Boolean) || dismissed) return null
  const first = clients[0]
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
        {["Add a client", "Add a site", "Run an audit"].map((label, i) => (
          <li key={label} className="flex items-center gap-2 text-sm">
            <StatusGlyph meaning={complete[i] ? "pass" : "queued"} />
            <span className="text-muted-foreground">{i + 1}.</span>
            {label}
            <span className="sr-only">{complete[i] ? "Complete" : "Pending"}</span>
          </li>
        ))}
      </ol>
      {first !== undefined && !complete[1] ? (
        <Link
          className="text-sm text-primary underline-offset-4 hover:underline"
          to="/app/clients/$clientId"
          params={{ clientId: first.id }}
        >
          Add your first site
        </Link>
      ) : null}
    </section>
  )
}
