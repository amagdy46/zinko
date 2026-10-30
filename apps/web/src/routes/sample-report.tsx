import { createFileRoute, Link } from "@tanstack/react-router"
import { FlaskConical } from "lucide-react"
import { Brand } from "@/components/logo"
import { PageShell } from "@/components/page-shell"
import { ReportView } from "@/components/report/report-view"
import { ThemeToggle } from "@/components/theme-toggle"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { pageTitle } from "@/lib/page-title"
import { sampleReport } from "@/lib/sample-report"

export const Route = createFileRoute("/sample-report")({
  head: () => ({
    meta: [
      ...pageTitle("Sample report").meta,
      {
        name: "description",
        content:
          "What a client receives after a Zinko tracking and consent audit: score, what to fix first, who fixes it, and the evidence.",
      },
    ],
  }),
  component: PublicSampleReport,
})

function PublicSampleReport() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between gap-2 border-b px-4 py-4 sm:px-6 print:hidden">
        <Brand />
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button asChild variant="ghost">
            <Link to="/sign-in">Sign in</Link>
          </Button>
          <Button asChild>
            <Link to="/sign-up">Sign up</Link>
          </Button>
        </div>
      </header>
      <main>
        <PageShell className="mx-auto">
          <div className="flex flex-wrap items-start justify-between gap-4 print:hidden">
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight">Sample report</h1>
              <p className="max-w-2xl text-sm text-muted-foreground">
                This is what a client receives after an audit: the score, what to fix first, who
                fixes it and the evidence behind each finding.
              </p>
            </div>
            <div className="space-y-1">
              <Button variant="outline" onClick={() => window.print()}>
                Save as PDF
              </Button>
              <p className="max-w-56 text-xs text-muted-foreground">
                In the print dialog, turn off headers and footers so the page address is not
                printed.
              </p>
            </div>
          </div>
          <Alert role="note" className="print:hidden">
            <FlaskConical aria-hidden="true" />
            <AlertTitle>Sample report — fictional data</AlertTitle>
            <AlertDescription>
              The shop, client and agency are made up and the findings come from a fixture test
              page, not a real audit. Your reports use your own branding and what Zinko finds on
              your site.
            </AlertDescription>
          </Alert>
          <p className="hidden text-sm text-muted-foreground print:block">
            Sample report: fictional shop and fixture data, not a real audit.
          </p>
          <ReportView model={sampleReport} logoSrc={null} mode="client" draft={false} />
          <div className="flex justify-center print:hidden">
            <Button asChild size="lg">
              <Link to="/sign-up">Audit your own site</Link>
            </Button>
          </div>
        </PageShell>
      </main>
    </div>
  )
}
