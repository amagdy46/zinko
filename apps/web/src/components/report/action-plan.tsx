import { CodeText } from "./code-text"
import { SeverityBadge } from "@/components/severity"
import { StatusGlyph } from "@/components/status-glyph"
import { OWNER_LABELS, type ReportModel } from "@/lib/report-model"

const LINK =
  "rounded-sm text-report-accent underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"

/** A title in a list is a target of its own: 32px high on screen, a plain line in print. */
const PLAN_LINK = `inline-flex min-h-8 items-center print:inline print:min-h-0 ${LINK}`

/** What to fix, grouped by who usually fixes it; accepted risks and fixed findings are listed apart. */
export function ActionPlan({ model }: { model: ReportModel }) {
  const set = model.findings.filter((f) => f.triage.status !== "open")
  return (
    <section
      id="plan"
      aria-label="Action plan"
      className="space-y-4 px-8 py-8 text-sm leading-6 print:p-0 print:pt-6 print:leading-snug"
    >
      <h2 className="text-xl font-semibold">Action plan</h2>
      {model.actionPlan.length === 0 ? (
        <p className="flex items-start gap-2" data-testid="plan-empty">
          <StatusGlyph meaning="pass" className="mt-0.5" />
          No open failing findings to act on.
        </p>
      ) : (
        <>
          <p className="max-w-[65ch] text-muted-foreground">
            Work through each group from the top: the most serious come first.
          </p>
          {model.actionPlan.map((group) => (
            <div key={group.owner ?? "none"} className="space-y-1.5">
              <h3 className="font-semibold">
                {group.owner === null ? "Owner not assigned" : OWNER_LABELS[group.owner]}
              </h3>
              <ol className="list-decimal space-y-2 pl-6 marker:text-muted-foreground marker:tabular-nums">
                {group.items.map((item) => (
                  <li key={item.ruleId} className="space-y-0.5 pl-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <SeverityBadge severity={item.severity} />
                      <a href={`#finding-${item.ruleId}`} className={`font-medium ${PLAN_LINK}`}>
                        {item.title}
                      </a>
                    </p>
                    <p className="max-w-[65ch] [overflow-wrap:anywhere]">
                      <span className="font-semibold">Ask for:</span>{" "}
                      <CodeText text={item.firstStep} />
                    </p>
                    <p className="max-w-[65ch] text-muted-foreground">
                      <span className="font-semibold">Done when:</span> a re-run no longer fails
                      this check.
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          ))}
          <p className="keep-together max-w-[65ch] font-medium">
            We recommend re-running the audit after the fixes, to confirm each one.
          </p>
        </>
      )}
      {set.length === 0 ? null : (
        <div className="space-y-1.5" data-testid="not-in-plan">
          <h3 className="font-semibold">Not in the plan</h3>
          <ul className="space-y-1.5">
            {set.map((f) => (
              <li key={f.ruleId} className="flex items-start gap-2">
                <StatusGlyph
                  meaning={f.triage.status === "fixed" ? "finished" : "none"}
                  className="mt-0.5"
                />
                <span className="[overflow-wrap:anywhere]">
                  <a href={`#finding-${f.ruleId}`} className={PLAN_LINK}>
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
