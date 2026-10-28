import { StatusGlyph } from "@/components/status-glyph"
import { count } from "@/lib/format"
import type { ReportModel } from "@/lib/report-model"

type Cell = ReportModel["consent"]["rows"][number]["cells"][number]

const CHOICE_SCENARIOS = new Set(["Accept all", "Reject all"])

/** Hits split at the choice, only where the choice was seen to take effect. */
function Split({ cell }: { cell: Cell }) {
  if (cell.choice.observed === 0)
    return <p className="text-muted-foreground">No choice was observed, so hits are not split</p>
  return (
    <p className="text-muted-foreground tabular-nums">
      Hits before the choice: {cell.choice.hitsBefore}. After the choice: {cell.choice.hitsAfter}{" "}
      (choice observed on {cell.choice.observed} of {count(cell.runs.total, "run")})
    </p>
  )
}

/** One cell's words. "Not captured" only when no run of the scenario was captured at all. */
function CellBody({ cell }: { cell: Cell }) {
  const { runs } = cell
  if (runs.total === 0 || runs.complete + runs.partial === 0)
    return (
      <p className="flex items-start gap-1.5">
        <StatusGlyph meaning="none" className="mt-0.5" />
        <span>Not captured</span>
      </p>
    )
  const fromPartial = runs.partial > 0 ? `from ${count(runs.partial, "partial capture")}` : null
  const missing = runs.none > 0 ? `${runs.none} not captured` : null
  const gaps = [fromPartial, missing].filter((note) => note !== null).join("; ")
  const fired = cell.runsWithHits > 0
  return (
    <div className="space-y-1">
      <p className="flex items-start gap-1.5 font-medium">
        <StatusGlyph meaning={fired ? "captured" : "could-not-check"} className="mt-0.5" />
        <span>{fired ? "Fired" : "None seen"}</span>
      </p>
      <p className="tabular-nums">
        {fired
          ? `${cell.runsWithHits} of ${count(runs.total, "run")}`
          : `in ${count(runs.complete + runs.partial, "captured run")}`}
        {fired ? `, ${count(cell.hits, "hit")}` : ""}
      </p>
      {fired && CHOICE_SCENARIOS.has(cell.scenario) ? <Split cell={cell} /> : null}
      {gaps === "" ? null : <p className="text-muted-foreground">{gaps}</p>}
    </div>
  )
}

/** What each vendor sent in each consent scenario. A hit is not a verdict: the findings decide. */
export function ConsentSummary({ model }: { model: ReportModel }) {
  const { consent } = model
  return (
    <section
      id="consent"
      aria-label="Consent scenarios"
      className="space-y-4 px-8 py-8 text-sm leading-7 print:break-before-page print:p-0 print:leading-normal"
    >
      <h2 className="text-xl font-semibold">Consent scenarios</h2>
      {consent.rows.length === 0 ? (
        <p className="flex items-start gap-2" data-testid="consent-empty">
          <StatusGlyph meaning="none" className="mt-0.5" />
          No GA4, Google Ads, Meta or TikTok request was seen in any run.
        </p>
      ) : (
        <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full min-w-[32rem] print:min-w-0 table-fixed border-collapse text-left align-top">
            <caption className="sr-only">Vendor by consent scenario</caption>
            <thead>
              <tr className="border-b">
                <th scope="col" className="w-24 py-2 pr-3 font-medium">
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
      <p className="text-muted-foreground">
        A hit is a request the browser sent, not a verdict: whether it is a problem is decided by
        the findings below.
      </p>
    </section>
  )
}
