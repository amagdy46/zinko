import { reportDate, type ReportModel } from "@/lib/report-model"

/**
 * The report's first page: the agency once (logo, or name when there is none), what the document is,
 * who it is for and when it was audited. The scope is in "Scope and method", not here. The client's
 * name is the page's h1 only on its own page; inside the app it is an h2.
 */
export function Cover({
  model,
  logoSrc,
  draft,
  published,
  standalone,
}: {
  model: ReportModel
  logoSrc: string | null
  draft: boolean
  published?: { version: number; publishedAt: string }
  standalone: boolean
}) {
  const { branding, cover } = model
  const ClientName = standalone ? "h1" : "h2"
  return (
    <section
      id="cover"
      aria-label="Cover"
      className="flex flex-col gap-16 border-t-8 border-report-accent px-8 py-10 print:min-h-[24cm] print:justify-between print:gap-0 print:p-0 print:pt-8"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {/* fetchPriority low keeps React from adding a <link rel="preload"> to the head, which would repeat the public logo URL (and its token) outside the img */}
        {logoSrc === null ? (
          <p className="min-w-0 text-lg font-semibold">{branding.agencyName}</p>
        ) : (
          <img
            src={logoSrc}
            alt={branding.agencyName}
            fetchPriority="low"
            className="max-h-14 max-w-48 shrink-0 object-contain"
          />
        )}
        {draft ? (
          <span className="shrink-0 rounded-md border px-2 py-1 text-xs text-muted-foreground print:hidden">
            Draft
          </span>
        ) : null}
      </div>
      <div className="space-y-3 print:space-y-4">
        <p className="text-sm font-medium uppercase tracking-wide text-report-accent">
          Tracking &amp; consent audit
        </p>
        <ClientName className="text-4xl font-semibold leading-tight">{cover.clientName}</ClientName>
        <p className="text-lg [overflow-wrap:anywhere]">
          {cover.siteName} <span className="text-muted-foreground">· {cover.host}</span>
        </p>
      </div>
      <div className="space-y-1 text-sm text-muted-foreground">
        <p>Audited on {reportDate(cover.auditedAt)}</p>
        {published === undefined ? null : (
          <p>
            Version {published.version}, published {reportDate(published.publishedAt)}
          </p>
        )}
      </div>
    </section>
  )
}
