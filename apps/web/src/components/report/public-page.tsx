import { renderToStaticMarkup } from "react-dom/server"
import { reportDate, type ReportModel } from "@/lib/report-model"
import { ReportView } from "./report-view"

function Document({
  title,
  stylesheet,
  children,
}: {
  title: string
  stylesheet: string
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow, noarchive" />
        <meta name="referrer" content="no-referrer" />
        <title>{title}</title>
        <link rel="stylesheet" href={stylesheet} />
      </head>
      <body>{children}</body>
    </html>
  )
}

const html = (element: React.ReactElement) => `<!doctype html>${renderToStaticMarkup(element)}`

/** The report a link points to, as static HTML: no hydration data, one script (the Print button). */
export function renderReportPage(input: {
  model: ReportModel
  stylesheet: string
  logoSrc: string | null
  version: number
  publishedAt: string
  newerPublishedAt: string | null
}): string {
  const { model } = input
  return html(
    <Document
      title={`${model.cover.clientName} · Tracking audit · ${model.branding.agencyName}`}
      stylesheet={input.stylesheet}
    >
      <header className="mx-auto flex max-w-[210mm] flex-wrap items-center justify-between gap-3 p-4 pb-0 md:px-6 md:pt-6 print:hidden">
        <p className="text-sm text-muted-foreground">
          Prepared by {model.branding.agencyName} · Version {input.version}
        </p>
        <button
          type="button"
          id="print-report"
          className="inline-flex h-8 items-center rounded-md border bg-card px-3 text-sm font-medium hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
        >
          Save as PDF
        </button>
      </header>
      <main className="mx-auto max-w-[210mm] space-y-4 p-4 md:p-6 print:p-0">
        {input.newerPublishedAt === null ? null : (
          <p
            role="note"
            className="rounded-md border border-sev-warning-border bg-sev-warning-bg p-3 text-sm"
          >
            A newer version was published on {reportDate(input.newerPublishedAt)}. This page shows
            version {input.version}; ask {model.branding.agencyName} for the current link.
          </p>
        )}
        <ReportView
          model={model}
          logoSrc={input.logoSrc}
          mode="client"
          standalone
          published={{ version: input.version, publishedAt: input.publishedAt }}
        />
        <p className="text-xs text-muted-foreground print:hidden">
          Save as PDF opens the print dialog. Turn off headers and footers there so the page address
          is not printed.
        </p>
      </main>
      <script src="/report-print.js" defer />
    </Document>,
  )
}

/** A short page for a link that is gone: the same text for every cause of a 404 (`agency` is null). */
export function renderNoticePage(input: {
  stylesheet: string
  heading: string
  agency: string | null
}): string {
  return html(
    <Document title={input.heading} stylesheet={input.stylesheet}>
      <main className="mx-auto max-w-md space-y-2 p-6 pt-24 text-center">
        <h1 className="text-lg font-semibold">{input.heading}</h1>
        {input.agency === null ? null : (
          <p className="text-sm text-muted-foreground">Ask {input.agency} for a new link.</p>
        )}
      </main>
    </Document>,
  )
}
