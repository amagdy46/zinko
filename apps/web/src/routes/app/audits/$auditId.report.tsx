import { createFileRoute, Link } from "@tanstack/react-router"
import { Download, Printer } from "lucide-react"
import { useState } from "react"
import { EmptyState } from "@/components/empty-state"
import {
  DisclosureDialog,
  EditSummary,
  FindingActions,
} from "@/components/report/consultant-controls"
import { Versions } from "@/components/report/versions"
import { ReportView } from "@/components/report/report-view"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { auditTabTitle, type TitleContext } from "@/lib/page-title"
import { getReportDraft } from "@/server/report"

export const Route = createFileRoute("/app/audits/$auditId/report")({
  validateSearch: (search: Record<string, unknown>): { share?: 1 } =>
    search.share === 1 || search.share === "1" ? { share: 1 } : {},
  head: ({ matches }: TitleContext) => auditTabTitle("Report", matches),
  loader: ({ params }) => getReportDraft({ data: { auditId: params.auditId } }),
  notFoundComponent: () => <p className="text-sm text-muted-foreground">Audit not found.</p>,
  component: ReportScreen,
})

function ReportScreen() {
  const draft = Route.useLoaderData()
  const { auditId } = Route.useParams()
  const [view, setView] = useState<"consultant" | "client">("consultant")
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
    <div className="space-y-4" data-report>
      <Versions
        auditId={auditId}
        versions={draft.versions}
        changes={draft.consultant.changesSincePublished}
        detail={draft.model.detail}
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm print:hidden">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={view}
          onValueChange={(next) => {
            if (next === "consultant" || next === "client") setView(next)
          }}
          aria-label="View"
        >
          <ToggleGroupItem value="consultant">Consultant view</ToggleGroupItem>
          <ToggleGroupItem value="client">Client view</ToggleGroupItem>
        </ToggleGroup>
        <DisclosureDialog
          auditId={auditId}
          detail={draft.model.detail}
          disclosure={draft.consultant.disclosure}
        />
        <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
          <Printer />
          Save as PDF
        </Button>
        <Button asChild variant="outline" size="sm">
          <a href={`/api/audits/${auditId}/register.csv`} download>
            <Download />
            Export CSV
          </a>
        </Button>
        {draft.canManageBranding ? (
          <Link
            to="/app/settings/branding"
            className="inline-flex h-8 items-center rounded-md underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Branding
          </Link>
        ) : (
          <span className="text-muted-foreground">
            Ask an owner or admin to change the agency's branding.
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground print:hidden">
        Save as PDF opens the print dialog. Turn off headers and footers there so the page address
        is not printed.
      </p>
      <ReportView
        model={draft.model}
        logoSrc={draft.logoUrl}
        mode={view}
        controls={
          view === "client"
            ? undefined
            : {
                summary: <EditSummary summary={draft.consultant.edits.summary} />,
                Finding: FindingActions,
                hiddenFindings: draft.consultant.hiddenFindings,
              }
        }
      />
    </div>
  )
}
