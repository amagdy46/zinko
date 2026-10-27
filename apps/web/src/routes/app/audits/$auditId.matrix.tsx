import { createFileRoute } from "@tanstack/react-router"
import { EmptyState } from "@/components/empty-state"
import { MatrixControls, TagMatrixTable, TagPager } from "@/components/tag-matrix"
import { count } from "@/lib/format"
import { type MatrixView, matrixView, TAGS_PER_PAGE } from "@/lib/tag-matrix"
import { getTagMatrix } from "@/server/matrix"

type Search = {
  viewport?: string
  by?: "page"
  page?: string
  scenario?: string
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
      tagPage: view.tagPage > 1 ? view.tagPage : undefined,
    }
  },
  loaderDeps: ({ search }) => ({ view: matrixView(search) }),
  loader: ({ params, deps }) => getTagMatrix({ data: { auditId: params.auditId, ...deps.view } }),
  notFoundComponent: () => <p className="text-sm text-muted-foreground">Audit not found.</p>,
  component: TagMatrixScreen,
})

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
        tagPage: next.tagPage > 1 ? next.tagPage : undefined,
      },
    })
  }
  const perPage = TAGS_PER_PAGE[matrix.by]
  const neverCaptured = matrix.columns.every((column) => column.runs.none === column.runs.total)
  const uncaptured = matrix.columns.reduce((total, column) => total + column.runs.none, 0)
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
            uncaptured > 0
              ? `No tag fired in the runs that were captured. ${count(uncaptured, "run")} could not be captured, so this is not a clean result.`
              : "No tag fired in this selection."
          }
        />
      )
    return (
      <>
        <TagMatrixTable auditId={auditId} matrix={matrix} />
        <TagPager matrix={matrix} perPage={perPage} onPage={(tagPage) => change({ tagPage })} />
        <p className="max-w-prose text-xs text-muted-foreground">
          {
            "Fired means the page sent the request; requests were answered locally when that option was on. None seen is only said of complete runs."
          }
        </p>
      </>
    )
  })()
  return (
    <div className="min-w-0 space-y-4">
      <div className="space-y-1">
        <h2 className="text-base font-medium">{"Which tags fired, on which events"}</h2>
        <p className="max-w-prose text-sm text-muted-foreground">
          {
            "Each cell counts the requests the page sent for a tag. n/m is the number of runs that had the event out of the column's runs."
          }
        </p>
      </div>
      <MatrixControls matrix={matrix} onChange={change} />
      {body}
    </div>
  )
}
