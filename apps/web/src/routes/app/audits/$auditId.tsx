import { createFileRoute, Link, Outlet, useRouter } from "@tanstack/react-router"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { PageHeader } from "@/components/page-header"
import { StatusBadge } from "@/components/status-badge"
import { StatusGlyph } from "@/components/status-glyph"
import { Progress } from "@/components/ui/progress"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { remainingTime, runPage, runReason, scenarioLabel } from "@/lib/audit-labels"
import { duration } from "@/lib/format"
import { useAuditRoom } from "@/lib/use-audit-room"
import { getAudit } from "@/server/audits"

export const Route = createFileRoute("/app/audits/$auditId")({
  loader: ({ params }) => getAudit({ data: { id: params.auditId } }),
  notFoundComponent: () => <p className="text-sm text-muted-foreground">Audit not found.</p>,
  component: AuditPage,
})

const ACTIVE = new Set(["queued", "running"])
const REFETCH_DELAY_MS = 250

function AuditPage() {
  const { audit, site, client, runs, summary } = Route.useLoaderData()
  const router = useRouter()
  const active = ACTIVE.has(audit.status)
  const refetch = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const previous = useRef({ id: audit.id, active })
  const [now, setNow] = useState<number | null>(null)
  const { connected } = useAuditRoom(
    audit.id,
    () => {
      clearTimeout(refetch.current)
      refetch.current = setTimeout(() => void router.invalidate(), REFETCH_DELAY_MS)
    },
    active,
  )
  useEffect(() => () => clearTimeout(refetch.current), [])
  useEffect(() => {
    if (!active) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  const findings = summary.findings.critical + summary.findings.warning + summary.findings.info
  const complete = runs.filter((r) => r.status === "complete").length
  const partial = runs.filter((r) => r.status === "partial").length
  const failed = runs.filter((r) => r.status === "failed").length
  const running = runs.filter((r) => r.status === "running").length
  const done = complete + partial + failed
  const start = audit.startedAt ?? audit.createdAt
  const elapsed = Math.max(
    0,
    (audit.finishedAt?.getTime() ?? now ?? start.getTime()) - start.getTime(),
  )
  const units = (run: (typeof runs)[number]) =>
    run.journey ? 1 + Math.min(5, audit.config.pages.length - 1) : 1
  const workUnits = runs.reduce((total, run) => total + units(run), 0)
  const remainingUnits = runs
    .filter((run) => run.status === "pending" || run.status === "running")
    .reduce((total, run) => total + units(run), 0)
  const left = remainingTime(remainingUnits, elapsed, workUnits)
  useEffect(() => {
    if (previous.current.id === audit.id && previous.current.active && !active) {
      const noun = findings === 1 ? "finding" : "findings"
      let message = `Audit complete: ${findings} ${noun}`
      if (audit.status === "failed") message = "Audit failed"
      if (audit.status === "partial" && summary.evaluatedRuns === 0)
        message = "Audit finished: not evaluated"
      else if (audit.status === "partial")
        message = `Audit finished with gaps: ${findings} ${noun}, ${partial + failed} ${partial + failed === 1 ? "run" : "runs"} incomplete`
      toast(message, {
        id: `audit-finished-${audit.id}`,
        action: {
          label: "Findings",
          onClick: () => {
            void router.navigate({
              to: "/app/audits/$auditId/findings",
              params: { auditId: audit.id },
            })
          },
        },
      })
    }
    previous.current = { id: audit.id, active }
  }, [audit.id, audit.status, active, findings, partial, failed, summary.evaluatedRuns, router])
  const problems = runs.filter((r) => r.status === "partial" || r.status === "failed")
  const navClass =
    "-mb-px border-b-2 border-transparent pt-1 pb-2 text-muted-foreground hover:text-foreground data-[status=active]:border-primary data-[status=active]:text-foreground"
  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        title={`Audit of ${site.name}`}
        breadcrumb={[
          { label: "Clients", to: "/app/clients" },
          { label: client.name, to: "/app/clients/$clientId", params: { clientId: client.id } },
          { label: site.name, to: "/app/sites/$siteId", params: { siteId: site.id } },
          { label: `Audit · ${audit.createdAt.toLocaleDateString()}` },
        ]}
        meta={
          <>
            <StatusBadge status={audit.status} />
            {active ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span tabIndex={0} className="inline-flex h-8 items-center gap-1.5">
                      <span
                        className={
                          connected
                            ? "size-2 rounded-full bg-primary"
                            : "size-2 rounded-full border border-muted-foreground"
                        }
                      />
                      {connected ? "Connected" : "Reconnecting"}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {connected
                      ? "Connected to live audit progress"
                      : "Reconnecting to live audit progress"}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : null}
          </>
        }
      />
      {active ? (
        <div className="space-y-3">
          <Progress value={done} max={Math.max(1, runs.length)} aria-label="Finished runs" />
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm tabular-nums">
            <span>
              {done} of {runs.length} runs
            </span>
            <span className="text-muted-foreground">{duration(elapsed)} elapsed</span>
            {left ? <span className="text-muted-foreground">{left}</span> : null}
            <span>{running} running</span>
            <span>{partial} partial</span>
            <span>{failed} failed</span>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-y-4 divide-x text-sm lg:grid-cols-4">
          <div className="pr-4">
            <p className="text-xs text-muted-foreground">Runs</p>
            <p className="tabular-nums">
              {runs.length}: {complete} complete, {partial} partial, {failed} failed
            </p>
            <div className="mt-2 flex h-1 overflow-hidden rounded-full" aria-hidden="true">
              {runs.map((run) => (
                <span key={run.id} className={`flex-1 ${barTone(run.status)}`} />
              ))}
            </div>
          </div>
          <div className="px-4">
            <p className="text-xs text-muted-foreground">Findings</p>
            <Link
              to="/app/audits/$auditId/findings"
              params={{ auditId: audit.id }}
              className="underline underline-offset-4"
            >
              {summary.evaluatedRuns === 0
                ? "Not evaluated"
                : `${findings}: ${summary.findings.critical} critical`}
            </Link>
            {summary.findings.couldNotCheck > 0 ? (
              <p className="text-xs text-muted-foreground">
                {summary.findings.couldNotCheck} could not check
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {summary.evaluatedRuns} of {runs.length} runs evaluated
            </p>
          </div>
          <div className="px-4">
            <p className="text-xs text-muted-foreground">Duration</p>
            <p className="font-mono tabular-nums">{duration(elapsed)}</p>
          </div>
          <div className="px-4">
            <p className="text-xs text-muted-foreground">Started</p>
            <time dateTime={start.toISOString()} className="tabular-nums">
              {start.toLocaleString()}
            </time>
          </div>
        </div>
      )}
      {audit.error ? (
        <p
          role="alert"
          className="rounded-md border border-sev-critical-border bg-sev-critical-bg p-3 text-sm text-sev-critical"
        >
          {audit.error}
        </p>
      ) : null}
      {problems.length > 0 ? (
        <div
          className={`space-y-2 rounded-md border p-3 text-sm ${failed > 0 ? "border-sev-critical-border bg-sev-critical-bg" : "border-sev-warning-border bg-sev-warning-bg"}`}
        >
          <h2 className="font-medium">
            {[failed > 0 && `${failed} failed`, partial > 0 && `${partial} partial`]
              .filter(Boolean)
              .join(" · ")}
          </h2>
          <ul className="space-y-1">
            {problems.map((run) => (
              <li key={run.id}>
                <Link
                  to="/app/audits/$auditId"
                  params={{ auditId: audit.id }}
                  search={{ view: "matrix", run: run.id }}
                  className="flex items-start gap-2 py-1.5 underline-offset-4 hover:underline"
                >
                  <StatusGlyph meaning={run.status === "failed" ? "failed" : "partial"} />
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    {runPage(run)} · {scenarioLabel(run.scenario)} · {run.viewport}:{" "}
                    {runReason(run)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <nav className="flex gap-4 border-b text-sm tabular-nums">
        <Link
          to="/app/audits/$auditId/overview"
          params={{ auditId: audit.id }}
          className={navClass}
        >
          Overview
        </Link>
        <Link
          to="/app/audits/$auditId"
          params={{ auditId: audit.id }}
          search={{ view: "matrix" }}
          activeOptions={{ exact: true, includeSearch: false }}
          className={navClass}
        >
          Runs {runs.length}
        </Link>
        <Link
          to="/app/audits/$auditId/findings"
          params={{ auditId: audit.id }}
          className={navClass}
        >
          Findings {summary.evaluatedRuns === 0 ? "(not evaluated)" : findings}
        </Link>
        <Link to="/app/audits/$auditId/hits" params={{ auditId: audit.id }} className={navClass}>
          Hits {summary.hits}
        </Link>
      </nav>
      <Outlet />
    </div>
  )
}

function barTone(status: string) {
  switch (status) {
    case "complete":
      return "bg-status-pass-solid"
    case "partial":
      return "bg-sev-warning-solid"
    case "failed":
      return "bg-sev-critical-solid"
    default:
      return "bg-muted"
  }
}
