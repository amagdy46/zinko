import { createFileRoute, Link } from "@tanstack/react-router"
import { Download, Ellipsis, Palette, Printer, Tag } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { AuditRunning } from "@/components/audit-running"
import { EmptyState } from "@/components/empty-state"
import {
  DisclosureDialog,
  ChangesControls,
  EditSummary,
  FindingActions,
} from "@/components/report/consultant-controls"
import { ReportIntro } from "@/components/report/report-intro"
import { Versions } from "@/components/report/versions"
import { ReportView } from "@/components/report/report-view"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { auditTabTitle, type TitleContext } from "@/lib/page-title"
import { markPreviewed } from "@/lib/report-previewed"
import { getReportDraft } from "@/server/report"

export const Route = createFileRoute("/app/audits/$auditId/report")({
  validateSearch: (search: Record<string, unknown>): { share?: 1; view?: "client" } => ({
    ...(search.share === 1 || search.share === "1" ? { share: 1 as const } : {}),
    ...(search.view === "client" ? { view: "client" as const } : {}),
  }),
  head: ({ matches }: TitleContext) => auditTabTitle("Report", matches),
  loader: ({ params }) => getReportDraft({ data: { auditId: params.auditId } }),
  notFoundComponent: () => <p className="text-sm text-muted-foreground">Audit not found.</p>,
  component: ReportScreen,
})

function ReportScreen() {
  const draft = Route.useLoaderData()
  const { auditId } = Route.useParams()
  const { view = "consultant" } = Route.useSearch()
  const navigate = Route.useNavigate()
  const [labelsOpen, setLabelsOpen] = useState(false)
  const moreRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (view === "client" && draft.available) markPreviewed(auditId)
  }, [view, draft.available, auditId])
  if (!draft.available && draft.reason === "narrow")
    return (
      <EmptyState
        title="Re-checks are not reported"
        description="A re-check covers a few pages for one check. Report on the audit it belongs to."
      />
    )
  if (!draft.available)
    return draft.reason === "running" ? (
      <AuditRunning what="The report" testId="report-running" />
    ) : (
      <EmptyState
        title="Not evaluated"
        description="No run of this audit has check results, so there is nothing to report. It is not clean: nothing can be said about its tracking."
      />
    )
  return (
    <div className="space-y-4" data-report>
      <div className="mx-auto w-full max-w-[210mm] space-y-4 print:hidden">
        <ReportIntro
          unbranded={draft.unbranded}
          canManageBranding={draft.canManageBranding}
          shared={draft.versions.length > 0}
        />
        <Versions
          auditId={auditId}
          versions={draft.versions}
          changes={draft.consultant.changesSincePublished}
          carriedNotes={draft.consultant.carriedNotes}
          detail={draft.model.detail}
          incomplete={draft.model.summary.runHealth.incomplete}
        >
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={view}
            onValueChange={(next) => {
              if (next === "consultant" || next === "client")
                void navigate({
                  search: (prev) => ({ ...prev, view: next === "client" ? "client" : undefined }),
                  replace: true,
                })
            }}
            aria-label="View"
          >
            <ToggleGroupItem value="consultant">Your view</ToggleGroupItem>
            <ToggleGroupItem value="client">Reader view</ToggleGroupItem>
          </ToggleGroup>
          <DisclosureDialog
            auditId={auditId}
            detail={draft.model.detail}
            disclosure={draft.consultant.disclosure}
            open={labelsOpen}
            onOpenChange={setLabelsOpen}
            menuOpener={moreRef}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button ref={moreRef} type="button" variant="outline" size="sm">
                <Ellipsis />
                More
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="min-h-8 justify-between gap-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                data-testid="disclosure"
                onSelect={() => setLabelsOpen(true)}
              >
                <span className="flex items-center gap-2">
                  <Tag />
                  Page addresses
                </span>
                <span className="text-xs text-muted-foreground">
                  {draft.model.detail === "standard" ? "Hidden" : "Shown"}
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="min-h-8 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                onSelect={() => window.print()}
              >
                <Printer />
                Save as PDF
              </DropdownMenuItem>
              <DropdownMenuItem
                className="min-h-8 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                asChild
              >
                <a href={`/api/audits/${auditId}/register.csv`} download>
                  <Download />
                  Export CSV
                </a>
              </DropdownMenuItem>
              {draft.canManageBranding ? (
                <DropdownMenuItem
                  className="min-h-8 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  asChild
                >
                  <Link to="/app/settings/branding">
                    <Palette />
                    Branding
                  </Link>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuLabel className="max-w-56 font-normal text-muted-foreground">
                  Ask an owner or admin to change the report's branding.
                </DropdownMenuLabel>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </Versions>
      </div>

      <ReportView
        model={draft.model}
        logoSrc={draft.logoUrl}
        mode={view}
        draft={
          view === "consultant" &&
          (draft.versions.length === 0 || draft.consultant.changesSincePublished)
        }
        controls={
          view === "client"
            ? undefined
            : {
                summary: (
                  <EditSummary
                    summary={draft.consultant.edits.summary}
                    headlines={draft.model.summary.headlines}
                  />
                ),
                changes:
                  draft.consultant.changeRows === null ? undefined : (
                    <ChangesControls
                      auditId={auditId}
                      includeChanges={draft.consultant.edits.includeChanges}
                      rows={draft.consultant.changeRows}
                    />
                  ),
                Finding: FindingActions,
                hiddenFindings: draft.consultant.hiddenFindings,
              }
        }
      />
    </div>
  )
}
