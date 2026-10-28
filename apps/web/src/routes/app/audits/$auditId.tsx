import {
  createFileRoute,
  Link,
  type LinkProps,
  Outlet,
  useLocation,
  useRouter,
} from "@tanstack/react-router"
import { NotFound } from "@/components/not-found"
import { useEffect, useRef, useState } from "react"
import { ChevronLeft } from "lucide-react"
import { toast } from "sonner"
import { RunPath } from "@/components/evidence"
import { PageHeader } from "@/components/page-header"
import { RerunDialog } from "@/components/rerun-dialog"
import { Button } from "@/components/ui/button"
import { StatusBadge, toBadgeStatus } from "@/components/status-badge"
import { StatusGlyph } from "@/components/status-glyph"
import { Progress } from "@/components/ui/progress"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { pageTitle } from "@/lib/page-title"
import {
  auditTabName,
  auditTitle,
  remainingTime,
  runReason,
  scenarioLabel,
} from "@/lib/audit-labels"
import { count, duration, shortDate, shortDateTime, useTimeZone } from "@/lib/format"
import { tabLink } from "@/lib/row-style"
import { cn } from "@/lib/utils"
import { useAuditRoom } from "@/lib/use-audit-room"
import { getAudit } from "@/server/audits"

export const Route = createFileRoute("/app/audits/$auditId")({
  loader: ({ params }) => getAudit({ data: { id: params.auditId } }),
  head: ({ loaderData }) =>
    pageTitle(
      loaderData === undefined
        ? "Audit"
        : auditTabName({
            kind: loaderData.audit.kind,
            siteName: loaderData.site.name,
            pages: loaderData.audit.config.pages.length,
            recheckTitle: loaderData.audit.recheckTitle,
          }),
    ),
  notFoundComponent: () => <NotFound what="Audit" />,
  component: AuditPage,
})

const SEVERITY_WORDS = [
  ["critical", "Critical"],
  ["warning", "Warning"],
  ["info", "Info"],
] as const

/** "5 Critical, 1 Warning": the open findings by severity, skipping the empty ones. */
const severitySplit = (open: { critical: number; warning: number; info: number }) =>
  SEVERITY_WORDS.filter(([key]) => open[key] > 0)
    .map(([key, word]) => `${open[key]} ${word}`)
    .join(", ")

const ACTIVE = new Set(["queued", "running"])
const REFETCH_DELAY_MS = 250

function AuditPage() {
  const { audit, site, client, runs, summary } = Route.useLoaderData()
  const router = useRouter()
  const timeZone = useTimeZone()
  const active = ACTIVE.has(audit.status)
  const refetch = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const tabBar = useRef<HTMLElement>(null)
  const href = useLocation({ select: (location) => location.href })
  const scrolledFor = useRef<string | null>(null)
  useEffect(() => {
    if (scrolledFor.current === href) return
    scrolledFor.current = href
    const bar = tabBar.current
    const current = bar?.querySelector<HTMLElement>('[aria-current="page"]')
    if (bar === null || bar === undefined || current === null || current === undefined) return
    const edge = current.offsetLeft + current.offsetWidth - bar.clientWidth
    if (edge > bar.scrollLeft) bar.scrollLeft = edge + 8
    else if (current.offsetLeft < bar.scrollLeft) bar.scrollLeft = current.offsetLeft - 8
  }, [href])
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
  const overview = useLocation({ select: (location) => location.pathname.endsWith("/overview") })
  const findings = summary.findings.critical + summary.findings.warning + summary.findings.info
  const openFindings = summary.open.critical + summary.open.warning + summary.open.info
  let findingsText = `${openFindings} open`
  let findingsSplit = `: ${severitySplit(summary.open)}`
  if (openFindings === 0) findingsSplit = ""
  if (summary.evaluatedRuns === 0) {
    findingsText = "Not evaluated"
    findingsSplit = ""
  }
  let findingsTab = `${openFindings}`
  if (summary.evaluatedRuns === 0) findingsTab = "(not evaluated)"
  if (active) findingsTab = "(in progress)"
  const complete = runs.filter((r) => r.status === "complete").length
  const partial = runs.filter((r) => r.status === "partial").length
  const failed = runs.filter((r) => r.status === "failed").length
  const running = runs.filter((r) => r.status === "running").length
  const done = complete + partial + failed
  const start = audit.startedAt ?? audit.createdAt
  // An audit is queued, with no start time, until a capture engine takes its first run; later waits
  // between runs show as no run running.
  const waiting = active && running === 0 && done < runs.length
  const elapsed =
    audit.startedAt === null && active
      ? 0
      : Math.max(0, (audit.finishedAt?.getTime() ?? now ?? start.getTime()) - start.getTime())
  const units = (run: (typeof runs)[number]) => {
    if (run.followHost !== null) return 2
    return run.journey ? 1 + Math.min(5, audit.config.pages.length - 1) : 1
  }
  const workUnits = runs.reduce((total, run) => total + units(run), 0)
  const remainingUnits = runs
    .filter((run) => run.status === "pending" || run.status === "running")
    .reduce((total, run) => total + units(run), 0)
  // Announce about every fifth of the runs, not every tick of the progress bar.
  const announceStep = Math.max(1, Math.ceil(runs.length / 5))
  const announced = Math.floor(done / announceStep) * announceStep
  const progressNote = waiting
    ? "Waiting for a capture slot"
    : remainingTime(remainingUnits, elapsed, workUnits)
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
          label: "Overview",
          onClick: () => {
            void router.navigate({
              to: "/app/audits/$auditId/overview",
              params: { auditId: audit.id },
            })
          },
        },
      })
    }
    previous.current = { id: audit.id, active }
  }, [audit.id, audit.status, active, findings, partial, failed, summary.evaluatedRuns, router])
  const problems = runs.filter((r) => r.status === "partial" || r.status === "failed")
  const full = overview || active
  const params = { auditId: audit.id }
  const named = {
    kind: audit.kind,
    siteName: site.name,
    pages: audit.config.pages.length,
    recheckTitle: audit.recheckTitle,
  }
  const title = auditTitle({ ...named, createdAt: audit.createdAt }, timeZone)
  const tabName = auditTabName(named)
  const tabs: ReadonlyArray<{ label: string; link: LinkProps }> = [
    { label: "Overview", link: { to: "/app/audits/$auditId/overview", params } },
    {
      label: `Runs ${runs.length}`,
      link: {
        to: "/app/audits/$auditId",
        params,
        search: { view: "matrix" },
        activeOptions: { exact: true, includeSearch: false },
      },
    },
    {
      label: `Findings ${findingsTab}`,
      link: { to: "/app/audits/$auditId/findings", params },
    },
    { label: "Compare", link: { to: "/app/audits/$auditId/compare", params } },
    { label: "Tag matrix", link: { to: "/app/audits/$auditId/matrix", params } },
    { label: `Hits ${summary.hits}`, link: { to: "/app/audits/$auditId/hits", params } },
    { label: "Report", link: { to: "/app/audits/$auditId/report", params } },
  ]
  const rerunButton = useRef<HTMLButtonElement>(null)
  const [rerunning, setRerunning] = useState(false)
  let rerunHint: string | undefined
  if (active) rerunHint = "Available when the audit has finished"
  if (site.archived) rerunHint = "This site is archived"
  const rerun =
    audit.kind === "full" ? (
      <>
        <Button
          ref={rerunButton}
          variant="outline"
          size="sm"
          className="h-8"
          disabled={active || site.archived}
          title={rerunHint}
          onClick={() => setRerunning(true)}
        >
          Re-run
        </Button>
        <RerunDialog
          auditId={audit.id}
          open={rerunning}
          onOpenChange={setRerunning}
          returnFocus={rerunButton}
        />
      </>
    ) : null
  const shareLink =
    audit.kind === "full" && !active && summary.evaluatedRuns > 0 ? (
      <Link
        to="/app/audits/$auditId/report"
        params={{ auditId: audit.id }}
        search={{ share: 1 }}
        className="inline-flex h-8 items-center rounded-md border px-3 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Share report
      </Link>
    ) : null
  const findingsLink = (
    <Link
      to="/app/audits/$auditId/findings"
      params={{ auditId: audit.id }}
      className="inline-flex h-8 items-center rounded-sm underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {findingsText}
      <span className="max-sm:sr-only">{findingsSplit}</span>
    </Link>
  )
  return (
    <div
      className={cn(
        "min-w-0 print:[&>:not([data-report])]:hidden",
        full ? "space-y-6" : "space-y-2",
      )}
    >
      {full ? (
        <PageHeader
          title={title}
          breadcrumb={[
            { label: "Clients", to: "/app/clients" },
            { label: client.name, to: "/app/clients/$clientId", params: { clientId: client.id } },
            { label: site.name, to: "/app/sites/$siteId", params: { siteId: site.id } },
            {
              label:
                audit.kind === "narrow"
                  ? "Re-check"
                  : `Audit · ${shortDate(audit.createdAt, timeZone)}`,
            },
          ]}
          meta={
            <>
              <StatusBadge status={toBadgeStatus(audit.status)} />
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
          actions={
            <>
              {rerun}
              {shareLink}
            </>
          }
        />
      ) : (
        <header className="flex flex-col gap-x-3 gap-y-0.5 text-sm sm:flex-row sm:flex-wrap sm:items-center sm:gap-y-1">
          <div className="flex min-w-0 items-center gap-x-3">
            <Link
              to="/app/sites/$siteId"
              params={{ siteId: site.id }}
              aria-label={`Back to ${site.name}`}
              className="inline-flex h-8 items-center gap-0.5 rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background max-sm:min-w-8 max-sm:justify-center"
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
              <span className="max-sm:sr-only">{site.name}</span>
            </Link>
            <h1 className="min-w-0 truncate text-base font-semibold tracking-tight">{tabName}</h1>
            <StatusBadge status={toBadgeStatus(audit.status)} />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 max-sm:pl-1">
            <span className="tabular-nums text-muted-foreground max-sm:hidden">
              {count(runs.length, "run")}
            </span>
            {findingsLink}
            <span className="tabular-nums text-muted-foreground max-sm:hidden">
              {duration(elapsed)}
            </span>
            <time
              dateTime={start.toISOString()}
              className="tabular-nums text-muted-foreground max-sm:hidden"
            >
              {shortDateTime(start, timeZone)}
            </time>
            {problems.length > 0 ? (
              <Link
                to="/app/audits/$auditId"
                params={{ auditId: audit.id }}
                search={{ view: "list" }}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  failed > 0
                    ? "border-sev-critical-border bg-sev-critical-bg text-sev-critical"
                    : "border-sev-warning-border bg-sev-warning-bg text-sev-warning",
                )}
              >
                <StatusGlyph meaning={failed > 0 ? "failed" : "partial"} />
                {problems.length} of {runs.length} runs could not finish
                <span className="max-sm:hidden">· See why</span>
              </Link>
            ) : null}
            {rerun}
            {shareLink}
          </div>
        </header>
      )}
      {active ? (
        <div className="space-y-3">
          <p role="status" className="sr-only">
            {announced} of {runs.length} runs finished
          </p>
          <Progress value={done} max={Math.max(1, runs.length)} aria-label="Finished runs" />
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm tabular-nums">
            <span>
              {done} of {runs.length} runs
            </span>
            <span className="text-muted-foreground">{duration(elapsed)} elapsed</span>
            {progressNote ? <span className="text-muted-foreground">{progressNote}</span> : null}
            <span>{running} running</span>
            <span>{partial} partial</span>
            <span>{failed} failed</span>
          </div>
        </div>
      ) : null}
      {overview && !active ? (
        <p className="flex flex-wrap items-center gap-x-4 text-sm tabular-nums text-muted-foreground">
          <span>
            {count(runs.length, "run")}: {complete} captured, {partial} partial, {failed} failed
          </span>
          {findingsLink}
          <span>{duration(elapsed)}</span>
          <time dateTime={start.toISOString()}>{shortDateTime(start, timeZone)}</time>
        </p>
      ) : null}
      {audit.error ? (
        <p
          role="alert"
          className="rounded-md border border-sev-critical-border bg-sev-critical-bg p-3 text-sm text-sev-critical"
        >
          {audit.error}
        </p>
      ) : null}
      {problems.length > 0 && active ? (
        <div
          className={`space-y-2 rounded-md border p-3 text-sm ${failed > 0 ? "border-sev-critical-border bg-sev-critical-bg" : "border-sev-warning-border bg-sev-warning-bg"}`}
        >
          <h2 className="font-medium">
            {problems.length} of {runs.length} runs could not finish
            {" ("}
            {[failed > 0 && `${failed} failed`, partial > 0 && `${partial} partial`]
              .filter(Boolean)
              .join(", ")}
            {")"}
          </h2>
          <p className="text-xs">Their results are missing or incomplete. Open one to see why.</p>
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
                    <RunPath run={run} className="max-w-full" /> · {scenarioLabel(run.scenario)} ·{" "}
                    {run.viewport}: {runReason(run)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <nav
        ref={tabBar}
        aria-label="Audit"
        className="scroll-edges -mx-1.5 flex gap-2.5 overflow-x-auto overflow-y-hidden border-b text-sm tabular-nums"
      >
        {tabs.map((tab) => (
          <Link key={tab.label} {...tab.link} className={tabLink}>
            {tab.label}
          </Link>
        ))}
      </nav>
      <Outlet />
    </div>
  )
}
