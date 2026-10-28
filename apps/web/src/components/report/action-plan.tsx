import { StatusGlyph } from "@/components/status-glyph"
import { OWNER_LABELS, type ReportModel } from "@/lib/report-model"

/** What to fix, grouped by who usually fixes it; accepted risks and fixed findings are listed apart. */
export function ActionPlan({ model }: { model: ReportModel }) {
  const set = model.findings.filter((f) => f.triage.status !== "open")
  return (
    <section
      id="plan"
      aria-label="Action plan"
      className="space-y-4 px-8 py-8 text-sm leading-7 print:break-before-page print:p-0 print:leading-normal"
    >
      <h2 className="text-xl font-semibold">Action plan</h2>
      {model.actionPlan.length === 0 ? (
        <p className="flex items-start gap-2" data-testid="plan-empty">
          <StatusGlyph meaning="pass" className="mt-0.5" />
          No open failing findings to act on.
        </p>
      ) : (
        model.actionPlan.map((group) => (
          <div key={group.owner ?? "none"} className="space-y-1.5">
            <h3 className="font-medium">
              {group.owner === null ? "Owner not assigned" : OWNER_LABELS[group.owner]}
            </h3>
            <ul className="space-y-1.5">
              {group.items.map((item) => (
                <li key={item.ruleId} className="flex items-start gap-2">
                  <StatusGlyph meaning={item.severity} className="mt-0.5" />
                  <span className="[overflow-wrap:anywhere]">
                    <a
                      href={`#finding-${item.ruleId}`}
                      className="font-medium text-report-accent underline underline-offset-4"
                    >
                      {item.title}
                    </a>
                    <span className="text-muted-foreground">: {item.firstStep}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
      {set.length === 0 ? null : (
        <div className="space-y-1.5" data-testid="not-in-plan">
          <h3 className="font-medium">Not in the plan</h3>
          <ul className="space-y-1.5">
            {set.map((f) => (
              <li key={f.ruleId} className="flex items-start gap-2">
                <StatusGlyph
                  meaning={f.triage.status === "fixed" ? "finished" : "none"}
                  className="mt-0.5"
                />
                <span className="[overflow-wrap:anywhere]">
                  <a
                    href={`#finding-${f.ruleId}`}
                    className="text-report-accent underline underline-offset-4"
                  >
                    {f.title}
                  </a>
                  <span className="text-muted-foreground">
                    {f.triage.status === "fixed"
                      ? ": fixed (marked fixed by the author, not re-verified)"
                      : ": accepted risk"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
