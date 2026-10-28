import { SeverityBadge } from "@/components/severity"
import type { StatusMeaning } from "@/components/status-glyph"
import { count } from "@/lib/format"
import { type Band, CRITICAL_CAP, type HealthScore, WEIGHT } from "@/lib/health-score"

type Scored = Extract<HealthScore, { evaluated: true }>

export const BAND_GLYPH: Record<Band, StatusMeaning> = {
  critical: "critical",
  attention: "warning",
  minor: "info",
  "no-failures": "pass",
}

const PURCHASE_FIELDS_RULE = "coverage.purchase-missing-fields"

const rests = (n: number) => (n === 1 ? "rests" : "rest")

/**
 * The score's arithmetic as static content: no disclosure, no popover, no hooks. The Overview puts
 * it in a popover and the report prints it as it is. `maxLines` keeps the first lines and says how
 * many more the appendix holds.
 */
export function ScoreArithmetic({
  score,
  scope,
  maxLines,
}: {
  score: Scored
  scope: string
  maxLines?: number
}) {
  const purchaseFailed = score.lines.some((l) => l.ruleId === PURCHASE_FIELDS_RULE)
  const shown = maxLines === undefined ? score.lines : score.lines.slice(0, maxLines)
  return (
    <>
      <p className="font-medium">How this is scored</p>
      <p>
        Starts at 100. Each failing check costs points, more for Critical, more when it fails on
        more pages.
      </p>
      <p className="text-muted-foreground">
        It describes what this audit ran ({scope}), not the whole site.
      </p>
      {score.lines.length === 0 ? (
        <p>No rule failed, so nothing is taken off.</p>
      ) : (
        <ul className="space-y-1.5" data-testid="score-lines">
          {shown.map((line) => (
            <li key={line.ruleId} className="flex items-start gap-2">
              <SeverityBadge severity={line.severity} />
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                {line.title}
                <span className="block text-xs text-muted-foreground">
                  failed on {line.failing} of {line.known} runs it could be checked on
                  {line.bannerUncertain > 0
                    ? `; ${count(line.bannerUncertain, "failing run")} ${rests(line.bannerUncertain)} on an undetected banner, counted in full`
                    : ""}
                </span>
              </span>
              <span className="tabular-nums">−{line.points.toFixed(1)}</span>
            </li>
          ))}
        </ul>
      )}
      {shown.length < score.lines.length ? (
        <p className="text-muted-foreground">
          And {count(score.lines.length - shown.length, "more line")} in the appendix.
        </p>
      ) : null}
      <p className="tabular-nums" data-testid="score-sum">
        100 − {score.total.toFixed(1)} = {Math.max(0, 100 - score.total).toFixed(1)}, rounded to{" "}
        {Math.max(0, Math.round(100 - score.total))}
        {score.capped ? `, capped to ${CRITICAL_CAP} because a Critical rule failed` : ""}
      </p>
      {purchaseFailed ? (
        <p className="text-muted-foreground">
          The purchase-fields rule is known to over-trigger, and the score does not dampen a false
          Critical.
        </p>
      ) : null}
    </>
  )
}

/** The formula, the weights and what is not scored, as static paragraphs. */
export function ScoreDetails({ score }: { score: Scored }) {
  const { uncertainty } = score
  return (
    <>
      <p>
        Each failing rule costs its weight ({WEIGHT.critical} Critical, {WEIGHT.warning} Warning,{" "}
        {WEIGHT.info} Info) times 0.5 plus half the share of runs it failed on, counting only runs
        where it could be checked.
      </p>
      <p>
        A Critical failure caps the score at {CRITICAL_CAP}
        {score.lines.some((l) => l.severity === "critical") && !score.capped
          ? "; here the points already put it lower"
          : ""}
        .
      </p>
      <p>
        Checks that could not run are left out of the shares, never counted as passes, and shown as
        Could not check ({count(uncertainty.checks, "check")} on {count(uncertainty.runs, "run")}{" "}
        for {count(uncertainty.rules, "rule")}). Triage does not change the score. A rule that is
        wrong about one run still costs points.
      </p>
      <p>
        Score version {score.version}. Rules versions: {score.versions.join(", ")}.
      </p>
    </>
  )
}
