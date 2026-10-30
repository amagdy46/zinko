import type { ReportModel } from "@/lib/report-model"

/** The agency's footer line and the Zinko credit: after the document on screen, on every page in print. */
export function Footer({ model }: { model: ReportModel }) {
  const { footerText, showPoweredBy } = model.branding
  if (footerText === null && !showPoweredBy) return null
  return (
    <footer className="keep-together flex flex-wrap justify-between gap-x-6 gap-y-1 border-t px-4 sm:px-8 py-3 text-xs text-muted-foreground print:mt-8 print:px-0">
      {footerText === null ? null : <p className="min-w-0 whitespace-pre-line">{footerText}</p>}
      {showPoweredBy ? <p className="shrink-0">Powered by Zinko</p> : null}
    </footer>
  )
}
