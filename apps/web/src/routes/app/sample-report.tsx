import { createFileRoute, Link } from "@tanstack/react-router"
import { FlaskConical } from "lucide-react"
import { PageContainer } from "@/components/page-container"
import { PageHeader } from "@/components/page-header"
import { ReportView } from "@/components/report/report-view"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { pageTitle } from "@/lib/page-title"
import { sampleReport } from "@/lib/sample-report"

export const Route = createFileRoute("/app/sample-report")({
  head: () => pageTitle("Sample report"),
  component: SampleReport,
})

function SampleReport() {
  return (
    <PageContainer className="max-w-none">
      <PageHeader
        title="Sample report"
        breadcrumb={[{ label: "Clients", to: "/app/clients" }, { label: "Sample report" }]}
        description="This is what your client receives after an audit: the score, what to fix first, who fixes it and the evidence behind each finding."
        actions={
          <Button asChild variant="outline">
            <Link to="/app/clients">Start with a client</Link>
          </Button>
        }
      />
      <Alert role="note">
        <FlaskConical aria-hidden="true" />
        <AlertTitle>Sample report — fictional data</AlertTitle>
        <AlertDescription>
          The agency, client and site are made up. Your reports use your own branding and what Zinko
          finds on your client's site.
        </AlertDescription>
      </Alert>
      <ReportView model={sampleReport} logoSrc={null} mode="client" draft={false} />
    </PageContainer>
  )
}
