import { BANNER_NOTE, SCENARIOS } from "@/lib/audit-labels"
import { count } from "@/lib/format"
import { reportDate, type ReportModel } from "@/lib/report-model"

const HINT_BY_LABEL = new Map(SCENARIOS.map((s) => [s.label, s.hint]))

/** What was audited and how: pages, scenarios, viewports, run counts, versions and two fixed sentences. */
export function Scope({ model }: { model: ReportModel }) {
  const { cover, method, summary } = model
  const { scope } = cover
  const runs = method.runs.complete + method.runs.partial + method.runs.failed
  return (
    <section
      id="scope"
      aria-label="Scope and method"
      className="space-y-4 px-8 py-8 text-sm leading-6 print:break-before-page print:p-0 print:leading-snug"
    >
      <h2 className="text-xl font-semibold">Scope and method</h2>
      <p>
        {count(runs, "run")} on {count(scope.pages.length, "page")}, audited on{" "}
        {reportDate(cover.auditedAt)}: {method.runs.complete} complete, {method.runs.partial}{" "}
        partial, {method.runs.failed} failed.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <h3 className="font-semibold">Pages</h3>
          <ul className="space-y-0.5 sm:columns-2">
            {scope.pages.map((page) => (
              <li key={page}>{page}</li>
            ))}
          </ul>
        </div>
        <div className="space-y-1">
          <h3 className="font-semibold">Viewports</h3>
          <p>{scope.viewports.join(" and ")}</p>
        </div>
      </div>
      <div className="space-y-1">
        <h3 className="font-semibold">Consent scenarios</h3>
        <ul className="space-y-0.5">
          {scope.scenarios.map((scenario) => (
            <li key={scenario}>
              <span className="font-medium">{scenario}</span>
              <span className="text-muted-foreground"> · {HINT_BY_LABEL.get(scenario) ?? ""}</span>
            </li>
          ))}
        </ul>
      </div>
      {scope.journey || scope.clickIds ? (
        <p>
          Also checked:{" "}
          {[
            scope.journey ? "a journey through the key pages in one browser session" : null,
            scope.clickIds ? "a landing from an ad click, with test click IDs" : null,
          ]
            .filter((line) => line !== null)
            .join("; ")}
          .
        </p>
      ) : null}
      <p className="text-muted-foreground" data-testid="versions">
        Rules version {method.rulesVersions.join(", ")}, score version {method.scoreVersion}
        {method.mixedVersions
          ? ". This audit mixes rules versions: runs were judged by different versions of the rules."
          : "."}
      </p>
      {summary.coverage.bannerUncertainRuns > 0 ? (
        <p className="rounded-md border border-dashed p-3" data-testid="scope-banner-note">
          {BANNER_NOTE.summary}
        </p>
      ) : null}
      <div className="space-y-2" data-testid="method-sentences">
        <p>
          Every finding comes from a deterministic rule applied to what the browser recorded. No
          model decides whether a check passes or fails.
        </p>
        <p>
          This report describes technical behaviour on the audited pages and scenarios. It is not
          legal advice and not a statement of legal compliance.
        </p>
      </div>
    </section>
  )
}
