import { getRouteApi, Link } from "@tanstack/react-router"
import { count } from "@/lib/format"

const auditRoute = getRouteApi("/app/audits/$auditId")

/** What a tab that needs a finished audit shows meanwhile: how far it is and where to look now. */
export function AuditRunning({ what, testId }: { what: string; testId: string }) {
  const { audit, runs, summary } = auditRoute.useLoaderData()
  const done = runs.filter(
    (r) => r.status === "complete" || r.status === "partial" || r.status === "failed",
  ).length
  const params = { auditId: audit.id }
  const link =
    "inline-flex h-8 items-center rounded-sm underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
  return (
    <section className="space-y-2 text-sm" data-testid={testId}>
      <h2 className="font-medium">{what} appear here when the audit finishes.</h2>
      <p className="text-muted-foreground">
        So far {done} of {count(runs.length, "run")} {done === 1 ? "has" : "have"} finished and{" "}
        {count(summary.hits, "hit")} {summary.hits === 1 ? "was" : "were"} recorded. This page
        updates by itself.
      </p>
      <p className="flex flex-wrap gap-x-4">
        <Link
          to="/app/audits/$auditId"
          params={params}
          search={{ view: "matrix" }}
          className={link}
        >
          Watch the runs
        </Link>
        <Link to="/app/audits/$auditId/hits" params={params} className={link}>
          Browse the hits so far
        </Link>
      </p>
    </section>
  )
}
