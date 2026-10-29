import { createFileRoute, Link } from "@tanstack/react-router"
import { Download, Ellipsis, Palette, Printer, Tag } from "lucide-react"
import { useEffect, useRef, useState } from "react"
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
          <ToggleGroupItem value="consultant">Consultant view</ToggleGroupItem>
          <ToggleGroupItem value="client">Client view</ToggleGroupItem>
        </ToggleGroup>
        <DisclosureDialog
          auditId={auditId}
          detail={draft.model.detail}
          disclosure={draft.consultant.disclosure}
          open={labelsOpen}
          onOpenChange={setLabelsOpen}
          menuOpener={moreRef}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="max-sm:hidden"
          title="Opens the print dialog. Turn off headers and footers there so the page address is not printed."
          onClick={() => window.print()}
        >
          <Printer />
          Save as PDF
        </Button>
        <Button asChild variant="outline" size="sm" className="max-sm:hidden">
          <a href={`/api/audits/${auditId}/register.csv`} download>
            <Download />
            Export CSV
          </a>
        </Button>
        {draft.canManageBranding ? (
          <Link
            to="/app/settings/branding"
            className="inline-flex h-8 items-center rounded-md underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background max-sm:hidden"
          >
            Branding
          </Link>
        ) : (
          <span className="text-muted-foreground max-sm:hidden">
            Ask an owner or admin to change the agency's branding.
          </span>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button ref={moreRef} type="button" variant="outline" size="sm" className="sm:hidden">
              <Ellipsis />
              More
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem className="min-h-8" onSelect={() => setLabelsOpen(true)}>
              <Tag />
              Show page addresses
            </DropdownMenuItem>
            <DropdownMenuItem className="min-h-8" onSelect={() => window.print()}>
              <Printer />
              Save as PDF
            </DropdownMenuItem>
            <DropdownMenuItem className="min-h-8" asChild>
              <a href={`/api/audits/${auditId}/register.csv`} download>
                <Download />
                Export CSV
              </a>
            </DropdownMenuItem>
            {draft.canManageBranding ? (
              <DropdownMenuItem className="min-h-8" asChild>
                <Link to="/app/settings/branding">
                  <Palette />
                  Branding
                </Link>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuLabel className="max-w-56 font-normal text-muted-foreground">
                Ask an owner or admin to change the agency's branding.
              </DropdownMenuLabel>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </Versions>

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
