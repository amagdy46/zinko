import { ScoreArithmetic, ScoreDetails } from "@/components/score-arithmetic"
import { SeverityBadge } from "@/components/severity"
import { StatusGlyph } from "@/components/status-glyph"
import { AREAS } from "@/lib/audit-labels"
import { count } from "@/lib/format"
import type { ReportModel } from "@/lib/report-model"

/** Everything behind the report: unresolved checks, runs that did not finish, the full arithmetic, the rules and a legend. */
export function Appendix({ model }: { model: ReportModel }) {
  const { appendix, summary, cover, leftOut } = model
  const scope = [
    count(cover.scope.pages.length, "page"),
    count(cover.scope.scenarios.length, "scenario"),
    cover.scope.viewports.join(" and "),
  ].join(" × ")
  return (
    <section
      id="appendix"
      aria-label="Appendix"
      className="space-y-6 px-8 py-8 text-sm leading-7 print:break-before-page print:p-0 print:leading-normal"
    >
      <h2 className="text-xl font-semibold">Appendix</h2>
      <div className="space-y-2">
        <h3 className="font-medium">A. Could not check</h3>
        {appendix.couldNotCheck.length === 0 ? (
          <p className="text-muted-foreground">Every check could be run.</p>
        ) : (
          <>
            <p className="text-muted-foreground">
              These checks could not be run on some runs. They are never counted as passes.
            </p>
            <ul className="space-y-1">
              {appendix.couldNotCheck.map((item) => (
                <li key={item.ruleId} className="flex items-start gap-2">
                  <StatusGlyph meaning="could-not-check" className="mt-0.5" />
                  <span>
                    {item.checkTitle}
                    <span className="text-muted-foreground"> · {count(item.runs, "run")}</span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div className="space-y-2">
        <h3 className="font-medium">B. Not evaluated</h3>
        {appendix.notEvaluated.length === 0 ? (
          <p className="text-muted-foreground">Every run finished.</p>
        ) : (
          <>
            <p className="text-muted-foreground">
              These runs did not finish. What they would have shown is not in this report.
            </p>
            <ul className="space-y-1">
              {appendix.notEvaluated.map((r) => (
                <li
                  key={`${r.page}|${r.scenario}|${r.viewport}`}
                  className="flex items-start gap-2 [overflow-wrap:anywhere]"
                >
                  <StatusGlyph meaning="partial" className="mt-0.5" />
                  <span>
                    {r.page}, {r.scenario}, {r.viewport}
                    <span className="text-muted-foreground">: {r.reason}</span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div className="space-y-2">
        <h3 className="font-medium">C. Left out of the detail</h3>
        {leftOut.length === 0 ? (
          <p className="text-muted-foreground">Nothing was left out.</p>
        ) : (
          <>
            <p className="text-muted-foreground">
              The author left these findings out of the detail above. They still count in the score.
            </p>
            <ul className="list-disc space-y-1 pl-5">
              {leftOut.map((item) => (
                <li key={item.ruleId}>{item.title}</li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div className="space-y-2">
        <h3 className="font-medium">D. How the score adds up</h3>
        <ScoreArithmetic score={summary.score} scope={scope} />
        <div className="space-y-2 text-xs text-muted-foreground">
          <ScoreDetails score={summary.score} />
        </div>
      </div>
      <div className="space-y-2">
        <h3 className="font-medium">E. Rules in this audit</h3>
        <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full min-w-[34rem] print:min-w-0 border-collapse text-left text-xs">
            <thead>
              <tr className="border-b">
                {[
                  "Rule",
                  "Area",
                  "Severity",
                  "Version",
                  "Pass",
                  "Fail",
                  "Could not check",
                  "Not applicable",
                ].map((head) => (
                  <th key={head} scope="col" className="px-2 py-1 font-medium">
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {appendix.rules.map((rule) => (
                <tr key={rule.ruleId} className="border-b align-top">
                  <td className="px-2 py-1 [overflow-wrap:anywhere]">{rule.title}</td>
                  <td className="px-2 py-1">{AREAS[rule.area] ?? rule.area}</td>
                  <td className="px-2 py-1">
                    <SeverityBadge severity={rule.severity} />
                  </td>
                  <td className="px-2 py-1 tabular-nums">{rule.version}</td>
                  <td className="px-2 py-1 tabular-nums">{rule.pass}</td>
                  <td className="px-2 py-1 tabular-nums">{rule.fail}</td>
                  <td className="px-2 py-1 tabular-nums">{rule.couldNotCheck}</td>
                  <td className="px-2 py-1 tabular-nums">{rule.notApplicable}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="space-y-2">
        <h3 className="font-medium">F. Legend</h3>
        <ul className="grid gap-1 sm:grid-cols-2">
          <li className="flex items-center gap-2">
            <StatusGlyph meaning="critical" /> Critical
          </li>
          <li className="flex items-center gap-2">
            <StatusGlyph meaning="warning" /> Warning
          </li>
          <li className="flex items-center gap-2">
            <StatusGlyph meaning="info" /> Info
          </li>
          <li className="flex items-center gap-2">
            <StatusGlyph meaning="pass" /> Pass: the check ran and found nothing
          </li>
          <li className="flex items-center gap-2">
            <StatusGlyph meaning="could-not-check" /> Could not check: never a pass
          </li>
          <li className="flex items-center gap-2">
            <StatusGlyph meaning="none" /> Not applicable, or not captured
          </li>
        </ul>
      </div>
    </section>
  )
}
