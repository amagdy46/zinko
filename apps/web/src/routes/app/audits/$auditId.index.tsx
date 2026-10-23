import { createFileRoute, getRouteApi, redirect } from "@tanstack/react-router"
import { Option, Schema } from "effect"
import { RunMatrix } from "@/components/run-matrix"
import { RunSheet } from "@/components/run-sheet"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

const auditRoute = getRouteApi("/app/audits/$auditId")
const View = Schema.Literals(["matrix", "list", "thumbnails"])
const decodeView = Schema.decodeUnknownOption(View)
const decodeRun = Schema.decodeUnknownOption(Schema.String)

export const Route = createFileRoute("/app/audits/$auditId/")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { view?: "matrix" | "list" | "thumbnails"; run?: string } => ({
    view: Option.getOrUndefined(decodeView(search.view)),
    run: Option.getOrUndefined(decodeRun(search.run)),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ parentMatchPromise, deps: search, params, cause }) => {
    const parent = await parentMatchPromise
    const data = parent.loaderData
    if (
      cause === "enter" &&
      data &&
      search.view === undefined &&
      search.run === undefined &&
      !["queued", "running"].includes(data.audit.status) &&
      data.findings.length > 0
    )
      throw redirect({ to: "/app/audits/$auditId/findings", params })
  },
  component: RunsPage,
})

function RunsPage() {
  const { runs, audit, findings } = auditRoute.useLoaderData()
  const { view = "matrix", run } = Route.useSearch()
  const navigate = Route.useNavigate()
  const select = (id?: string) => {
    void navigate({ search: { view, run: id } })
  }
  return (
    <div id="runs-view" tabIndex={-1} className="min-w-0 space-y-4 outline-none">
      <ToggleGroup
        type="single"
        value={view}
        variant="outline"
        size="sm"
        aria-label="Runs view"
        onValueChange={(value) => {
          const next = decodeView(value)
          if (Option.isSome(next)) void navigate({ search: { view: next.value, run } })
        }}
      >
        {(["matrix", "list", "thumbnails"] as const).map((value) => (
          <ToggleGroupItem key={value} value={value} className="capitalize">
            {value}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <RunMatrix runs={runs} view={view} sheetOpen={run !== undefined} onSelect={select} />
      <RunSheet
        auditId={audit.id}
        runs={runs}
        findings={findings}
        selected={run}
        onSelect={select}
      />
    </div>
  )
}
