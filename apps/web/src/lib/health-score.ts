import { count } from "./format"

export const SCORE_VERSION = 2
export const WEIGHT = { critical: 20, warning: 8, info: 2 } as const
export const CRITICAL_CAP = 79

export type ScoreSeverity = keyof typeof WEIGHT

export interface ScoreFinding {
  ruleId: string
  title: string
  severity: ScoreSeverity
  failingRuns: number
  /** Runs where the rule was pass or fail: could-not-check and not-applicable runs are not counted. */
  knownRuns: number
  /** Failing runs under `none` whose banner was not detected, or could not be told. Shown, not discounted. */
  bannerUncertainRuns: number
}

export interface Uncertainty {
  checks: number
  runs: number
  rules: number
  ruleTitles: ReadonlyArray<string>
  /** Failing banner-dependent checks (rule x run) whose banner detection is not `detected`. */
  bannerUncertainRuns: number
}

export interface ScoreLine {
  ruleId: string
  title: string
  severity: ScoreSeverity
  failing: number
  known: number
  points: number
  bannerUncertain: number
}

export type Band = "critical" | "attention" | "minor" | "no-failures"

export type HealthScore =
  | { evaluated: false }
  | {
      evaluated: true
      version: number
      score: number
      band: Band
      /** Evaluation coverage only: runs with check results against runs in the audit. */
      coverage: "full" | "partial"
      resolution: "resolved" | "unresolved"
      lines: ReadonlyArray<ScoreLine>
      total: number
      capped: boolean
      uncertainty: Uncertainty
      versions: ReadonlyArray<string>
      mixedVersions: boolean
    }

export const BAND_LABEL: Record<Band, string> = {
  critical: "Critical issues",
  attention: "Needs attention",
  minor: "Minor issues only",
  "no-failures": "No failing checks",
}

const BAND_OF: Record<ScoreSeverity, Band> = {
  critical: "critical",
  warning: "attention",
  info: "minor",
}

const SEVERITY_ORDER: ReadonlyArray<ScoreSeverity> = ["critical", "warning", "info"]

/**
 * Failing findings cost their weight times (0.5 + 0.5 x the share of the runs where the rule could
 * be checked that it failed on). Runs where it could not be checked are left out of the share, so
 * unknowns neither dilute nor improve the score. A critical finding caps it. Triage is not an input.
 */
export function healthScore(input: {
  findings: ReadonlyArray<ScoreFinding>
  uncertainty: Uncertainty
  evaluatedRuns: number
  totalRuns: number
  versions: ReadonlyArray<string>
}): HealthScore {
  if (input.evaluatedRuns === 0) return { evaluated: false }
  const lines = input.findings
    .map((f) => ({
      ruleId: f.ruleId,
      title: f.title,
      severity: f.severity,
      failing: f.failingRuns,
      known: f.knownRuns,
      bannerUncertain: f.bannerUncertainRuns,
      points: WEIGHT[f.severity] * (0.5 + (0.5 * f.failingRuns) / f.knownRuns),
    }))
    .toSorted(
      (a, b) =>
        SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
        b.points - a.points ||
        a.ruleId.localeCompare(b.ruleId),
    )
  const total = lines.reduce((sum, line) => sum + line.points, 0)
  const rounded = Math.max(0, Math.round(100 - total))
  const worst = SEVERITY_ORDER.find((s) => lines.some((l) => l.severity === s))
  const capped = worst === "critical" && rounded > CRITICAL_CAP
  return {
    evaluated: true,
    version: SCORE_VERSION,
    score: capped ? CRITICAL_CAP : rounded,
    band: worst === undefined ? "no-failures" : BAND_OF[worst],
    coverage: input.evaluatedRuns >= input.totalRuns ? "full" : "partial",
    resolution:
      input.uncertainty.checks > 0 || input.uncertainty.bannerUncertainRuns > 0
        ? "unresolved"
        : "resolved",
    lines,
    total,
    capped,
    uncertainty: input.uncertainty,
    versions: input.versions,
    mixedVersions: input.versions.length > 1,
  }
}

/** What a score was computed from, in numbers every screen can obtain for an audit. */
export interface ScoreCoverage {
  totalRuns: number
  /** Runs with check results. */
  evaluatedRuns: number
  /** Runs that ended partial or failed. */
  unfinishedRuns: number
  /** Check results stored (rule x run). */
  checks: number
  /** Check results that could not be resolved to pass, fail or not applicable. */
  unresolvedChecks: number
  /** Sites of a client with no scored audit; zero for a single audit or site. */
  unauditedSites: number
}

/**
 * Two tiers. "runs": some run has no check results or ended partial or failed (which includes an
 * incomplete audit), or a client site has no audit: the score covers less than was asked, so it is
 * "Not fully checked". "checks": every run was evaluated but some checks could not be resolved;
 * that is near-constant (hygiene.tag-errors cannot tell when vendor requests are answered
 * locally), so it only adds a quiet count. "full": every check resolved. Banner uncertainty is a
 * caveat on failing findings, not on coverage.
 */
export function scoreCoverage(c: ScoreCoverage): {
  state: "full" | "checks" | "runs"
  notes: ReadonlyArray<string>
} {
  const runNotes: string[] = []
  if (c.evaluatedRuns < c.totalRuns)
    runNotes.push(`${c.evaluatedRuns} of ${count(c.totalRuns, "run")} checked`)
  if (c.unfinishedRuns > 0 && c.evaluatedRuns >= c.totalRuns)
    runNotes.push(`${count(c.unfinishedRuns, "run")} did not finish`)
  if (c.unauditedSites > 0) runNotes.push(`${count(c.unauditedSites, "site")} not audited yet`)
  const checkNotes =
    c.unresolvedChecks > 0
      ? [`${c.checks - c.unresolvedChecks} of ${count(c.checks, "check")} resolved`]
      : []
  const notes = [...runNotes, ...checkNotes]
  if (runNotes.length > 0) return { state: "runs", notes }
  return { state: checkNotes.length > 0 ? "checks" : "full", notes }
}

/** Half the runs or fewer were captured (evaluated and finished): too little to put a number on. */
export function tooLittleCaptured(c: ScoreCoverage): boolean {
  const captured = Math.min(c.evaluatedRuns, c.totalRuns - c.unfinishedRuns)
  return captured * 2 <= c.totalRuns
}
