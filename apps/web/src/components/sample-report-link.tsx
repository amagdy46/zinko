import { Link, useRouterState } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"

/** Where a first-time user, before any audit, sees what the finished deliverable looks like. It remembers the page it was opened from. */
export function SampleReportLink() {
  const from = useRouterState({ select: (state) => state.location.href })
  return (
    <Button asChild variant="outline">
      <Link to="/app/sample-report" search={{ from }}>
        See a sample report
      </Link>
    </Button>
  )
}
