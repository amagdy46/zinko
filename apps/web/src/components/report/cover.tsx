import { count } from "@/lib/format"
import { reportDate, type ReportModel } from "@/lib/report-model"

/** The report's first page: who it is from, who it is for, what it covers. */
export function Cover({
  model,
  logoSrc,
  draft,
}: {
  model: ReportModel
  logoSrc: string | null
  draft: boolean
}) {
  const { branding, cover } = model
  const { scope } = cover
  return (
    <section
      id="cover"
      aria-label="Cover"
      className="space-y-8 border-t-8 border-report-accent px-8 py-10 print:p-0 print:pt-8"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {logoSrc === null ? null : (
            <img src={logoSrc} alt="" className="max-h-14 max-w-40 object-contain" />
          )}
          <p className="text-lg font-semibold">{branding.agencyName}</p>
        </div>
        {draft ? (
          <span className="shrink-0 rounded-md border px-2 py-1 text-xs text-muted-foreground print:hidden">
            Draft
          </span>
        ) : null}
      </div>
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Tracking audit</p>
        <h1 className="text-3xl font-semibold">{cover.clientName}</h1>
        <p className="text-base [overflow-wrap:anywhere]">
          {cover.siteName} <span className="text-muted-foreground">· {cover.host}</span>
        </p>
        <p className="text-sm text-muted-foreground">Audited on {reportDate(cover.auditedAt)}</p>
      </div>
      <dl className="grid gap-4 rounded-md border p-4 text-sm sm:grid-cols-2">
        <div className="sm:col-span-2">
          <dt className="font-medium">Pages ({scope.pages.length})</dt>
          <dd>
            <ul className="mt-1 space-y-0.5 sm:columns-2">
              {scope.pages.map((page) => (
                <li key={page}>{page}</li>
              ))}
            </ul>
          </dd>
        </div>
        <div>
          <dt className="font-medium">Consent scenarios</dt>
          <dd>{scope.scenarios.join(", ")}</dd>
        </div>
        <div>
          <dt className="font-medium">Viewports</dt>
          <dd>{scope.viewports.join(" and ")}</dd>
        </div>
        {scope.journey || scope.clickIds ? (
          <div className="sm:col-span-2">
            <dt className="font-medium">Also checked</dt>
            <dd>
              {[
                scope.journey ? "a journey through the key pages in one browser session" : null,
                scope.clickIds ? "a landing from an ad click, with test click IDs" : null,
              ]
                .filter((line) => line !== null)
                .join("; ")}
            </dd>
          </div>
        ) : null}
      </dl>
      <p className="text-sm text-muted-foreground">
        Prepared by {branding.agencyName} ·{" "}
        {count(
          model.method.runs.complete + model.method.runs.partial + model.method.runs.failed,
          "run",
        )}
      </p>
    </section>
  )
}
