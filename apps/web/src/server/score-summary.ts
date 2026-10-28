import { pageIndexOf } from "@/lib/page-match"
import { healthScore, type ScoreFinding, type Uncertainty } from "@/lib/health-score"

const LOAD_FAILURES = new Set(["Navigation", "HttpStatus", "Timeout"])

interface SummaryRun {
  pageUrl: string
  status: string
  failure: string | null
  errors: ReadonlyArray<{ code: string; message: string }>
}

/**
 * The score, the score without accepted risks and whether the audit is incomplete: the one
 * calculation behind the Overview and the report, so they print the same figures. `reasonOf` says
 * why the start page failed (the Overview may show an engine message, the report never does).
 */
export function scoreSummaryOf<Run extends SummaryRun>(input: {
  findings: ReadonlyArray<ScoreFinding & { triage: { status: string } }>
  uncertainty: Uncertainty
  coverage: { evaluatedRuns: number; totalRuns: number; rulesVersions: ReadonlyArray<string> }
  runs: ReadonlyArray<Run>
  startUrl: string | undefined
  reasonOf: (run: Run) => string | null
}) {
  const { findings, uncertainty, coverage, runs, startUrl } = input
  const scoreOf = (counted: ReadonlyArray<ScoreFinding>) =>
    healthScore({
      findings: counted,
      uncertainty,
      evaluatedRuns: coverage.evaluatedRuns,
      totalRuns: coverage.totalRuns,
      versions: coverage.rulesVersions,
    })
  const startRuns = runs.filter(
    (r) => startUrl !== undefined && pageIndexOf([startUrl], r.pageUrl) === 0,
  )
  const loadFailed = (r: Run) =>
    r.status === "failed" ||
    (r.status === "partial" && r.errors.some((e) => LOAD_FAILURES.has(e.code)))
  const startFailed = startRuns.length > 0 && startRuns.every(loadFailed)
  const pages = new Map<string, Run[]>()
  for (const r of runs) {
    if (startRuns.includes(r)) continue
    const page = r.pageUrl
    pages.set(page, [...(pages.get(page) ?? []), r])
  }
  const brokenPages = [...pages].flatMap(([page, [first, ...rest]]) =>
    first !== undefined && [first, ...rest].every(loadFailed)
      ? [{ page, reason: input.reasonOf(first) }]
      : [],
  )
  const unfinished = runs.filter((r) => r.status === "failed" || r.status === "partial")
  const withoutAccepted = scoreOf(findings.filter((f) => f.triage.status !== "accepted_risk"))
  const [firstStartRun] = startRuns
  return {
    score: scoreOf(findings),
    withoutAccepted: withoutAccepted.evaluated ? withoutAccepted.score : null,
    runHealth: {
      startFailed,
      startPage: startUrl ?? null,
      startReason: startFailed && firstStartRun ? input.reasonOf(firstStartRun) : null,
      brokenPages,
      unfinishedRuns: unfinished.length,
      incomplete:
        startFailed ||
        brokenPages.length > 0 ||
        (runs.length > 0 && unfinished.length * 2 >= runs.length),
    },
  }
}
