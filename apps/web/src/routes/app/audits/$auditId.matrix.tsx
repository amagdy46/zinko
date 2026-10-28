import { createFileRoute } from "@tanstack/react-router"
import { CircleHelp } from "lucide-react"
import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { MatrixControls, TagMatrixTable, TagPager } from "@/components/tag-matrix"
import { count } from "@/lib/format"
import { type MatrixView, matrixView, TAGS_PER_PAGE } from "@/lib/tag-matrix"
import { getTagMatrix } from "@/server/matrix"

type Search = {
  viewport?: string
  by?: "page"
  page?: string
  scenario?: string
  mode?: "consent"
  tagPage?: number
}

export const Route = createFileRoute("/app/audits/$auditId/matrix")({
  validateSearch: (search: Record<string, unknown>): Search => {
    const view = matrixView(search)
    return {
      viewport: view.viewport,
      by: view.by === "page" ? "page" : undefined,
      page: view.page,
      scenario: view.scenario,
      mode: view.mode === "consent" ? "consent" : undefined,
      tagPage: view.tagPage > 1 ? view.tagPage : undefined,
    }
  },
  loaderDeps: ({ search }) => ({ view: matrixView(search) }),
  loader: ({ params, deps }) => getTagMatrix({ data: { auditId: params.auditId, ...deps.view } }),
  notFoundComponent: () => <p className="text-sm text-muted-foreground">Audit not found.</p>,
  component: TagMatrixScreen,
})

function Legend({ mode }: { mode: MatrixView["mode"] }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="shrink-0">
          <CircleHelp aria-hidden="true" />
          How to read it
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)] text-sm">
        {mode === "events" ? (
          "n/m is the runs that had the event out of the column's runs; ×n is the hits in a single run. None seen is only said of complete runs."
        ) : (
          <>
            Ads is <span className="font-mono text-xs">ad_storage</span> and Analytics is{" "}
            <span className="font-mono text-xs">analytics_storage</span>, as the hits carried them
            (Google's gcs and gcd signal), not the order of the consent commands. Mixed means the
            tag's hits carried more than one state. Meta and TikTok hits carry no consent signal. A
            run whose choice was not seen has no state after the choice.
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

function TagMatrixScreen() {
  const matrix = Route.useLoaderData()
  const { auditId } = Route.useParams()
  const navigate = Route.useNavigate()
  const view = matrixView(Route.useSearch())
  const change = (patch: Partial<MatrixView>) => {
    const next: MatrixView = { ...view, ...patch, tagPage: patch.tagPage ?? 1 }
    void navigate({
      search: {
        viewport: next.viewport,
        by: next.by === "page" ? "page" : undefined,
        page: next.by === "scenario" && next.page !== "all" ? next.page : undefined,
        scenario: next.by === "page" ? next.scenario : undefined,
        mode: next.mode === "consent" ? "consent" : undefined,
        tagPage: next.tagPage > 1 ? next.tagPage : undefined,
      },
    })
  }
  const perPage = TAGS_PER_PAGE[matrix.by]
  const neverCaptured = matrix.columns.every((column) => column.runs.none === column.runs.total)
  const uncaptured = matrix.columns.reduce((total, column) => total + column.runs.none, 0)
  const partial = matrix.columns.reduce((total, column) => total + column.runs.partial, 0)
  const incomplete = [
    partial > 0 &&
      `${count(partial, "run")} ${partial === 1 ? "was" : "were"} captured only in part`,
    uncaptured > 0 && `${count(uncaptured, "run")} could not be captured`,
  ].filter((part) => part !== false)
  const showsTable = matrix.columns.length > 0 && !neverCaptured && matrix.tagTotal > 0
  const body = (() => {
    if (matrix.columns.length === 0)
      return (
        <EmptyState
          title="No runs for this selection"
          description="This audit has no runs for the chosen viewport, pages and scenario."
        />
      )
    if (neverCaptured)
      return (
        <EmptyState
          title="Not captured"
          description="None of the runs in this selection was captured, so nothing can be said about which tags fired."
        />
      )
    if (matrix.tagTotal === 0)
      return (
        <EmptyState
          title="No tags were seen"
          description={
            incomplete.length > 0
              ? `No tag was seen in this selection, but ${incomplete.join(" and ")}, so the observation is incomplete and this is not a clean result.`
              : "No tag fired in this selection."
          }
        />
      )
    return (
      <>
        <TagMatrixTable auditId={auditId} matrix={matrix} mode={view.mode} />
        <TagPager matrix={matrix} perPage={perPage} onPage={(tagPage) => change({ tagPage })} />
      </>
    )
  })()
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="text-base font-medium">
            {view.mode === "events"
              ? "Which tags fired, on which events"
              : "Observed consent state before and after the choice"}
          </h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            {view.mode === "events"
              ? "Each cell counts the requests the page sent for a tag."
              : "The consent state each tag's hits carried, split at the visitor's choice. An update is never inferred from the choice completing."}
          </p>
        </div>
        {showsTable ? <Legend mode={view.mode} /> : null}
      </div>
      <MatrixControls matrix={matrix} mode={view.mode} onChange={change} />
      {body}
    </div>
  )
}
