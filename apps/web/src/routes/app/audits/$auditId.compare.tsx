import { createFileRoute } from "@tanstack/react-router"
import { getComparison } from "@/server/compare"

export const Route = createFileRoute("/app/audits/$auditId/compare")({
  validateSearch: (search: Record<string, unknown>): { against?: string } => ({
    against: typeof search.against === "string" ? search.against : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ params, deps }) =>
    getComparison({
      data: {
        auditId: params.auditId,
        ...(deps.against === undefined ? {} : { against: deps.against }),
      },
    }),
  component: CompareJson,
})

function CompareJson() {
  const data = Route.useLoaderData()
  return <pre data-testid="compare-json">{JSON.stringify(data, null, 1)}</pre>
}
