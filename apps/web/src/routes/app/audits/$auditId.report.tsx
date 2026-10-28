import { createFileRoute, Link } from "@tanstack/react-router"
import { EmptyState } from "@/components/empty-state"
import { ReportView } from "@/components/report/report-view"
import { getReportDraft } from "@/server/report"

export const Route = createFileRoute("/app/audits/$auditId/report")({
  loader: ({ params }) => getReportDraft({ data: { auditId: params.auditId } }),
  notFoundComponent: () => <p className="text-sm text-muted-foreground">Audit not found.</p>,
  component: ReportScreen,
})

function ReportScreen() {
  const draft = Route.useLoaderData()
  if (!draft.available)
    return draft.reason === "running" ? (
      <p className="text-sm text-muted-foreground" data-testid="report-running">
        Available when the audit finishes
      </p>
    ) : (
      <EmptyState
        title="Not evaluated"
        description="No run of this audit has check results, so there is nothing to report. It is not clean: nothing can be said about its tracking."
      />
    )
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span
          className="inline-flex h-8 items-center rounded-md border px-3"
          data-testid="report-status"
        >
          Draft, not shared
        </span>
        {draft.canManageBranding ? (
          <Link
            to="/app/settings/branding"
            className="inline-flex h-8 items-center rounded-md underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            Branding
          </Link>
        ) : (
          <span className="text-muted-foreground">
            Ask an owner or admin to change the agency's branding.
          </span>
        )}
      </div>
      <ReportView model={draft.model} logoSrc={draft.logoUrl} mode="consultant" />
    </div>
  )
}
