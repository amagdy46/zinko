import { createFileRoute, useRouter } from "@tanstack/react-router"
import { FlaskConical } from "lucide-react"
import { PageContainer } from "@/components/page-container"
import { PageHeader } from "@/components/page-header"
import { ReportView } from "@/components/report/report-view"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { pageTitle } from "@/lib/page-title"
import { safeRedirect } from "@/lib/redirect"
import { sampleReport } from "@/lib/sample-report"

/** What the page the sample was opened from is called, for the way back; null when it is not one we name. */
const backLabel = (path: string): string | null => {
  const { pathname } = new URL(path, "http://app.invalid")
  if (pathname === "/app/clients") return "Clients"
  if (/^\/app\/sites\/[^/]+\/audits\/new$/.test(pathname)) return "New audit"
  if (/^\/app\/sites\/[^/]+$/.test(pathname)) return "the site"
  if (/^\/app\/clients\/[^/]+$/.test(pathname)) return "the client"
  return null
}

export const Route = createFileRoute("/app/sample-report")({
  validateSearch: (search: Record<string, unknown>): { from?: string } => {
    const from = safeRedirect(search.from)
    return search.from === from && backLabel(from) !== null ? { from } : {}
  },
  head: () => pageTitle("Sample report"),
  component: SampleReport,
})

function SampleReport() {
  const { from } = Route.useSearch()
  const router = useRouter()
  const label = from === undefined ? null : backLabel(from)
  return (
    <PageContainer className="max-w-none">
      <PageHeader
        title="Sample report"
        breadcrumb={[{ label: "Clients", to: "/app/clients" }, { label: "Sample report" }]}
        description="This is what your client receives after an audit: the score, what to fix first, who fixes it and the evidence behind each finding."
        actions={
          <Button
            variant="outline"
            onClick={() =>
              void (from === undefined
                ? router.navigate({ to: "/app/clients" })
                : router.navigate({ href: from }))
            }
          >
            {label === null ? "Start with a client" : `Back to ${label}`}
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
