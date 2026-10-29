import { Link } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"

/** Where a first-time user, before any audit, sees what the finished deliverable looks like. */
export function SampleReportLink() {
  return (
    <Button asChild variant="outline">
      <Link to="/app/sample-report">See a sample report</Link>
    </Button>
  )
}
