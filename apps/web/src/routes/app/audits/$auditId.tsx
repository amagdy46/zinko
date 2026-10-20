import { createFileRoute, Link, Outlet, useRouter } from "@tanstack/react-router"
import { useEffect, useRef } from "react"
import { StatusBadge } from "@/components/status-badge"
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
  const { audit, site, runs } = Route.useLoaderData()
  const router = useRouter()
  const active = ACTIVE.has(audit.status)
  const refetch = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // a run's events arrive in pairs a few ms apart; one reload covers both
  const { connected } = useAuditRoom(
    audit.id,
    () => {
      clearTimeout(refetch.current)
      refetch.current = setTimeout(() => void router.invalidate(), REFETCH_DELAY_MS)
    },
    active,
  )
  useEffect(() => () => clearTimeout(refetch.current), [])
  const done = runs.filter((r) => r.status !== "pending" && r.status !== "running").length

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="flex gap-1 text-sm text-muted-foreground">
          <Link
            to="/app/sites/$siteId"
            params={{ siteId: site.id }}
            className="hover:text-foreground"
          >
            {site.name}
          </Link>
          <span>/</span>
          <span>Audit</span>
        </div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Audit of {site.name}</h1>
          <StatusBadge status={audit.status} />
          {active ? (
            <span className="text-xs text-muted-foreground">
              {connected ? "Live" : "Reconnecting"}
            </span>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {new Date(audit.createdAt).toLocaleString()} · {done} of {runs.length} runs finished ·{" "}
          {audit.config.pages.length} {audit.config.pages.length === 1 ? "page" : "pages"}
        </p>
        {audit.error === null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {audit.error}
          </p>
        )}
      </div>
      <nav className="flex gap-4 border-b text-sm">
        <Link
          to="/app/audits/$auditId"
          params={{ auditId: audit.id }}
          activeOptions={{ exact: true }}
          className="-mb-px border-b-2 border-transparent pb-2 text-muted-foreground hover:text-foreground data-[status=active]:border-primary data-[status=active]:text-foreground"
        >
          Runs
        </Link>
        <Link
          to="/app/audits/$auditId/hits"
          params={{ auditId: audit.id }}
          className="-mb-px border-b-2 border-transparent pb-2 text-muted-foreground hover:text-foreground data-[status=active]:border-primary data-[status=active]:text-foreground"
        >
          Hits
        </Link>
      </nav>
      <Outlet />
    </div>
  )
}
