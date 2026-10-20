import { createFileRoute, getRouteApi } from "@tanstack/react-router"
import { StatusBadge } from "@/components/status-badge"
import { pagePath, runReason, scenarioLabel } from "@/lib/audit-labels"
import { cn } from "@/lib/utils"

const auditRoute = getRouteApi("/app/audits/$auditId")

export const Route = createFileRoute("/app/audits/$auditId/")({
  component: RunsGrid,
})

type RunTile = ReturnType<typeof auditRoute.useLoaderData>["runs"][number]

function RunsGrid() {
  const { runs } = auditRoute.useLoaderData()
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
      {runs.map((run) => (
        <li key={run.id}>
          <Tile run={run} />
        </li>
      ))}
    </ul>
  )
}

function Tile({ run }: { run: RunTile }) {
  const reason = runReason(run)
  const finished = run.status !== "pending" && run.status !== "running"
  return (
    <article
      data-testid="run-tile"
      className="flex h-full flex-col gap-2 overflow-hidden rounded-lg border bg-card p-3 text-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <code className="truncate text-xs" title={run.pageUrl}>
          {pagePath(run.pageUrl)}
        </code>
        <StatusBadge status={run.status} />
      </div>
      <p className="text-xs text-muted-foreground">
        {scenarioLabel(run.scenario)} · {run.viewport}
      </p>
      <div
        className={cn(
          "aspect-[16/10] w-full overflow-hidden rounded-md border bg-muted",
          run.status === "running" && "animate-pulse",
        )}
      >
        {run.screenshotUrl === null ? null : (
          <img
            src={run.screenshotUrl}
            alt={`${pagePath(run.pageUrl)} under ${scenarioLabel(run.scenario)}, ${run.viewport}`}
            loading="lazy"
            className="size-full object-cover object-top"
          />
        )}
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Hits</span>
        <span className="font-mono tabular-nums">{finished ? run.hitCount : "-"}</span>
      </div>
      {reason === null ? null : (
        <p className={cn("text-xs", run.status === "failed" ? "text-destructive" : "text-warning")}>
          {reason}
        </p>
      )}
    </article>
  )
}
