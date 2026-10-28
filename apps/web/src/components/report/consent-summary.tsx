import { StatusGlyph } from "@/components/status-glyph"
import type { ReportModel } from "@/lib/report-model"

type Cell = ReportModel["consent"]["rows"][number]["cells"][number]

const CHOICE_SCENARIOS = new Set(["Accept all", "Reject all"])
const PARTIAL_MARK = "*"
const MISSING_MARK = "†"

/** One cell: a glyph and one line, with the before and after counts only where the vendor fired and the choice was seen. */
function CellBody({ cell }: { cell: Cell }) {
  const { runs } = cell
  if (runs.total === 0 || runs.complete + runs.partial === 0)
    return (
      <p className="flex items-start gap-1.5">
        <StatusGlyph meaning="none" className="mt-1" />
        <span>Not captured</span>
      </p>
    )
  const marks = `${runs.partial > 0 ? PARTIAL_MARK : ""}${runs.none > 0 ? MISSING_MARK : ""}`
  const fired = cell.runsWithHits > 0
  const split = fired && CHOICE_SCENARIOS.has(cell.scenario) && cell.choice.observed > 0
  return (
    <div className="space-y-0.5">
      <p className="flex items-start gap-1.5 leading-5 tabular-nums">
        <StatusGlyph meaning={fired ? "captured" : "could-not-check"} className="mt-1" />
        <span>
          <span className="font-medium">{fired ? "Fired" : "None seen"}</span>
          {" · "}
          {fired ? `${cell.runsWithHits} of ${runs.total}` : `0 of ${runs.complete + runs.partial}`}
          {marks}
        </span>
      </p>
      {split ? (
        <p className="pl-5 text-xs text-muted-foreground tabular-nums">
          {cell.choice.hitsBefore} before, {cell.choice.hitsAfter} after the choice
        </p>
      ) : null}
    </div>
  )
}

function Footnotes({ rows }: { rows: ReportModel["consent"]["rows"] }) {
  const cells = rows.flatMap((row) => row.cells)
  const notes = [
    cells.some((c) => c.runs.partial > 0 && c.runs.complete + c.runs.partial > 0)
      ? `${PARTIAL_MARK} Counts include partial captures, where some data is missing.`
      : null,
    cells.some((c) => c.runs.none > 0 && c.runs.complete + c.runs.partial > 0)
      ? `${MISSING_MARK} Some runs in this scenario were not captured.`
      : null,
    cells.some((c) => c.runsWithHits > 0 && CHOICE_SCENARIOS.has(c.scenario))
      ? "Before and after counts are hits on runs where the choice was seen to take effect."
      : null,
    "Fired · 2 of 3 means the vendor sent a request on 2 of the 3 runs of that scenario; None seen counts the runs captured.",
    "A hit is a request the browser sent, not a verdict: whether it is a problem is decided by the findings below.",
  ].filter((note) => note !== null)
  return (
    <ul className="space-y-0.5 text-xs text-muted-foreground">
      {notes.map((note) => (
        <li key={note}>{note}</li>
      ))}
    </ul>
  )
}

/** What each vendor sent in each consent scenario. A hit is not a verdict: the findings decide. */
export function ConsentSummary({ model }: { model: ReportModel }) {
  const { consent } = model
  return (
    <section
      id="consent"
      aria-label="Consent scenarios"
      className="space-y-4 px-8 py-8 text-sm leading-6 print:break-before-page print:p-0 print:leading-snug"
    >
      <h2 className="text-xl font-semibold">Consent scenarios</h2>
      {consent.rows.length === 0 ? (
        <p className="flex items-start gap-2" data-testid="consent-empty">
          <StatusGlyph meaning="none" className="mt-0.5" />
          No GA4, Google Ads, Meta or TikTok request was seen in any run.
        </p>
      ) : (
        <div
          role="region"
          aria-label="Vendor by consent scenario, scrolls sideways on a narrow screen"
          tabIndex={0}
          className="scroll-edges overflow-x-auto outline-none [--background:var(--card)] focus-visible:ring-[3px] focus-visible:ring-ring/50 print:overflow-visible"
        >
          <table className="w-full min-w-[32rem] print:min-w-0 table-fixed border-collapse text-left align-top">
            <caption className="sr-only">Vendor by consent scenario</caption>
            <thead>
              <tr className="border-b">
                <th scope="col" className="w-28 py-2 pr-3 font-medium">
                  Vendor
                </th>
                {consent.scenarios.map((scenario) => (
                  <th key={scenario} scope="col" className="px-2 py-2 font-medium">
                    {scenario}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {consent.rows.map((row) => (
                <tr key={row.vendor} className="border-b align-top">
                  <th scope="row" className="py-2 pr-3 font-medium">
                    {row.vendor}
                  </th>
                  {row.cells.map((cell) => (
                    <td key={cell.scenario} className="px-2 py-2">
                      <CellBody cell={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Footnotes rows={consent.rows} />
    </section>
  )
}
