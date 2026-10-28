import { JOURNEY_STEPS, TEST_CLICK_IDS } from "@repo/core/audit"
import type { HealthScore } from "./health-score"

/*
 * The comparison of two audits of one site, a pure function of their derived rows (see the M6 plan,
 * "The comparison"). A cell is page x scenario x viewport x journey; a finding is judged only on
 * the cells both audits ran and checked, and every cell that failed before stays in the picture
 * until it is positively resolved.
 */

export type Verdict = "fail" | "could_not_check" | "pass" | "not_applicable" | "not_run"
export type ChangeState =
  | "new"
  | "regressed"
  | "unchanged"
  | "fixed"
  | "verdict_changed"
  | "not_comparable"
export type NotComparable =
  | "rule_changed"
  | "rule_added"
  | "rule_removed"
  | "no_shared_scope"
  | "partly_rechecked"
export type Resolution =
  | "pass"
  | "not_applicable"
  | "still_fails"
  | "could_not_check"
  | "missing"
  | "consent_differs"
  | "banner_differs"
export type TriageState = "open" | "accepted_risk" | "fixed"
export type Severity = "critical" | "warning" | "info"

/** The structural identity of a run. What the run observed is `Compat`, never identity. */
export interface CellKey {
  /** The configured page: for an injected run the audit's start URL, else the run's own URL. */
  page: string
  scenario: string
  viewport: string
  /** Null for a plain run; for a journey run the capped itinerary the workflow walks. */
  itinerary: string[] | null
  /** Whether the test click IDs were actually applied to this run's URL. */
  injected: boolean
}

/** What a run observed, compared before its verdicts are trusted. */
export interface Compat {
  consentClass: "applied" | "not_applied"
  banner: "detected" | "not-detected" | "unknown" | null
}

const normalised = (url: string) => (URL.canParse(url) ? new URL(url).href : url)

/**
 * True only when all six test click IDs are present with exactly their values: a real
 * `gclid=ABC123` or `utm_source=newsletter` is a campaign URL, not an injection.
 */
export const injectionOf = (url: string) => {
  if (!URL.canParse(url)) return false
  const { searchParams } = new URL(url)
  return Object.entries(TEST_CLICK_IDS).every(([name, value]) => searchParams.get(name) === value)
}

export const cellKeyOf = (
  run: { pageUrl: string; scenario: string; viewport: string; journey: boolean },
  config: { pages: ReadonlyArray<string> },
): CellKey => {
  const injected = injectionOf(run.pageUrl)
  const [start = run.pageUrl] = config.pages
  return {
    page: normalised(injected ? start : run.pageUrl),
    scenario: run.scenario,
    viewport: run.viewport,
    itinerary: run.journey
      ? [start, ...config.pages.slice(1, 1 + JOURNEY_STEPS)].map(normalised)
      : null,
    injected,
  }
}

const cellId = (k: CellKey) =>
  JSON.stringify([k.page, k.scenario, k.viewport, k.itinerary, k.injected])

export interface CellRun {
  id: string
  cell: CellKey
  compat: Compat
  decoder: string | null
}

export interface CheckRow {
  runId: string
  ruleId: string
  status: "pass" | "fail" | "inconclusive" | "not_applicable"
  rulesVersion: string
}

export interface RuleWording {
  title: string
  severity: Severity
  area: string
  owner: string | null
}

export interface TriageLine {
  status: TriageState
  at: string | null
  inheritedFrom: { auditId: string | null; at: string } | null
}

export interface FindingChange {
  ruleId: string
  title: string
  severity: Severity
  area: string
  owner: string | null
  state: ChangeState
  reason: NotComparable | null
  was: Verdict
  now: Verdict
  fixedHow: "passes" | "no_longer_applies" | null
  spread: "same" | "narrowed" | "widened" | "moved" | null
  qualifier: "partly_unknown_before" | null
  resolution: Record<Resolution, number>
  cells: { common: number; failedBefore: number; failedNow: number; outside: number }
  /** `cell` indexes `Comparison.cells`. A finding that fails on the same cells as before lists only a few. */
  cellChanges: { cell: number; before: Verdict; now: Verdict | Resolution }[]
  cellChangesTotal: number
  earlierFailure: { auditId: string; date: string } | null
  triage: { before: TriageLine | null; now: TriageLine }
}

export interface AuditRef {
  id: string
  createdAt: string
  status: string
}

export interface Comparability {
  commonCells: number
  onlyBefore: number
  onlyNow: number
  rulesChanged: { from: string[]; to: string[]; ruleIds: string[] }
  bannerDiffersCells: number
  consentDiffersCells: number
  unevaluatedCellsBefore: number
  decoderVersionsDiffer: boolean
}

export interface ScoreLine {
  before: number | null
  now: number | null
  delta: number | null
  deltaWhyNot: string | null
  scoreVersion: number | null
}

export interface Comparison {
  now: AuditRef
  before: AuditRef
  /** Every cell any `cellChanges` entry names, so a cell is sent once. */
  cells: CellKey[]
  findings: FindingChange[]
  counts: Record<ChangeState, number>
  comparability: Comparability
  score: ScoreLine
}

export interface Side {
  runs: ReadonlyArray<CellRun>
  checks: ReadonlyArray<CheckRow>
  wording: ReadonlyMap<string, RuleWording>
  triage: ReadonlyMap<string, TriageLine>
}

/** An earlier evaluated full audit of the site, newest first, with the check rows of the candidate rules. */
export interface HistoryAudit {
  auditId: string
  date: string
  runs: ReadonlyArray<CellRun>
  checks: ReadonlyArray<CheckRow>
}

const OPEN: TriageLine = { status: "open", at: null, inheritedFrom: null }
const MAX_CELL_CHANGES = 50
const MAX_CELL_CHANGES_UNCHANGED = 10

const STATE_ORDER: ChangeState[] = [
  "regressed",
  "new",
  "verdict_changed",
  "fixed",
  "unchanged",
  "not_comparable",
]
const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 }
const codeUnitOrder = (a: string, b: string) => {
  if (a < b) return -1
  return a > b ? 1 : 0
}

const verdictOf = (status: CheckRow["status"] | undefined): Verdict => {
  if (status === undefined) return "not_run"
  return status === "inconclusive" ? "could_not_check" : status
}

const aggregate = (rows: Iterable<CheckRow>): Verdict => {
  const seen = new Set<string>()
  for (const row of rows) seen.add(row.status)
  if (seen.has("fail")) return "fail"
  if (seen.has("inconclusive")) return "could_not_check"
  if (seen.has("pass")) return "pass"
  return seen.size > 0 ? "not_applicable" : "not_run"
}

const emptyResolution = (): Record<Resolution, number> => ({
  pass: 0,
  not_applicable: 0,
  still_fails: 0,
  could_not_check: 0,
  missing: 0,
  consent_differs: 0,
  banner_differs: 0,
})

interface Input {
  before: Side
  now: Side
  history: ReadonlyArray<HistoryAudit>
  bannerDependent: ReadonlySet<string>
  ruleChanged: (ruleId: string, judgedBy: readonly string[]) => boolean
}

type RuleRows = Map<string, CheckRow>

const index = (side: Side) => {
  const runByCell = new Map(side.runs.map((r) => [cellId(r.cell), r]))
  const cellByRun = new Map(side.runs.map((r) => [r.id, cellId(r.cell)]))
  const rows = new Map<string, RuleRows>()
  for (const row of side.checks) {
    const cell = cellByRun.get(row.runId)
    if (cell === undefined) continue
    const rule = rows.get(row.ruleId) ?? new Map<string, CheckRow>()
    rule.set(cell, row)
    rows.set(row.ruleId, rule)
  }
  return { runByCell, rows }
}

/** The facts a verdict depends on must agree before two verdicts are set side by side. */
const compatDiffers = (
  ruleId: string,
  before: CellRun,
  now: CellRun,
  bannerDependent: ReadonlySet<string>,
): "consent_differs" | "banner_differs" | null => {
  if (before.compat.consentClass !== now.compat.consentClass) return "consent_differs"
  if (
    before.cell.scenario === "none" &&
    bannerDependent.has(ruleId) &&
    before.compat.banner !== now.compat.banner
  )
    return "banner_differs"
  return null
}

const failingCells = (rows: RuleRows | undefined) =>
  [...(rows ?? [])].filter(([, row]) => row.status === "fail").map(([cell]) => cell)

/**
 * The newest earlier audit (before the baseline, in creation order, not baseline ancestry) in
 * which the rule failed on at least one of the cells that fail now, on cells where the baseline
 * passed or did not apply, and whose rules version the registry says is comparable. An audit that
 * did not check or did not run those cells neither confirms nor breaks the chain.
 */
const earlierFailureOf = (
  ruleId: string,
  failingNow: ReadonlyArray<string>,
  rowsBefore: RuleRows,
  currentVersions: readonly string[],
  input: Input,
): FindingChange["earlierFailure"] => {
  const eligible = new Set(
    failingNow.filter((cell) => {
      const status = rowsBefore.get(cell)?.status
      return status === "pass" || status === "not_applicable"
    }),
  )
  for (const audit of input.history) {
    const cellByRun = new Map(audit.runs.map((r) => [r.id, cellId(r.cell)]))
    for (const row of audit.checks) {
      if (row.ruleId !== ruleId || row.status !== "fail") continue
      const cell = cellByRun.get(row.runId)
      if (cell === undefined || !eligible.has(cell)) continue
      if (input.ruleChanged(ruleId, [row.rulesVersion, ...currentVersions])) continue
      return { auditId: audit.auditId, date: audit.date }
    }
  }
  return null
}

const decodersOf = (side: Side) =>
  [...new Set(side.runs.map((r) => r.decoder ?? ""))].toSorted(codeUnitOrder)

const versionsOfSide = (side: Side) =>
  [...new Set(side.checks.map((c) => c.rulesVersion))].toSorted(codeUnitOrder)

const wordingOf = (rows: RuleRows | undefined, side: Side, ruleId: string) => {
  const wording = side.wording.get(ruleId)
  if (rows === undefined || wording === undefined) return undefined
  return { version: Math.max(...[...rows.values()].map((r) => Number(r.rulesVersion))), wording }
}

/**
 * Compares two audits' findings, cell by cell. Per rule, in order: not comparable (rules changed,
 * the rule on one side only, no shared cell), then what the current audit says about every cell
 * that failed before, and whether the rule fails anywhere now.
 */
export const compareAudits = (input: Input) => {
  const { before, now, bannerDependent } = input
  const b = index(before)
  const n = index(now)

  let common = 0
  let bannerDiffers = 0
  let consentDiffers = 0
  for (const [id, runBefore] of b.runByCell) {
    const runNow = n.runByCell.get(id)
    if (runNow === undefined) continue
    common += 1
    if (runBefore.compat.consentClass !== runNow.compat.consentClass) consentDiffers += 1
    else if (runBefore.cell.scenario === "none" && runBefore.compat.banner !== runNow.compat.banner)
      bannerDiffers += 1
  }
  const checkedRuns = new Set(before.checks.map((c) => c.runId))

  const candidates = new Set<string>()
  for (const rows of [before.checks, now.checks])
    for (const row of rows)
      if (row.status === "fail" || row.status === "inconclusive") candidates.add(row.ruleId)

  const findings: FindingChange[] = []
  const cells: CellKey[] = []
  const cellAt = new Map<string, number>()
  const changedRuleIds: string[] = []
  for (const ruleId of [...candidates].toSorted(codeUnitOrder)) {
    const rowsBefore = b.rows.get(ruleId)
    const rowsNow = n.rows.get(ruleId)
    const wordingBefore = wordingOf(rowsBefore, before, ruleId)
    const wordingNow = wordingOf(rowsNow, now, ruleId)
    const wording =
      wordingBefore !== undefined &&
      (wordingNow === undefined || wordingBefore.version > wordingNow.version)
        ? wordingBefore.wording
        : wordingNow?.wording
    if (wording === undefined) continue

    const baselineFails = new Set(failingCells(rowsBefore))
    const failsNow = new Set(failingCells(rowsNow))
    const commonCells = new Set<string>()
    for (const [cell, runBefore] of b.runByCell) {
      const runNow = n.runByCell.get(cell)
      if (runNow === undefined || !rowsBefore?.has(cell) || !rowsNow?.has(cell)) continue
      if (compatDiffers(ruleId, runBefore, runNow, bannerDependent) === null) commonCells.add(cell)
    }

    const resolution = emptyResolution()
    const resolutionOf = new Map<string, Resolution>()
    for (const cell of baselineFails) {
      const runBefore = b.runByCell.get(cell)
      const runNow = n.runByCell.get(cell)
      let found: Resolution
      if (runBefore === undefined || runNow === undefined) found = "missing"
      else {
        const differs = compatDiffers(ruleId, runBefore, runNow, bannerDependent)
        const row = rowsNow?.get(cell)
        if (differs !== null) found = differs
        else if (row === undefined) found = "missing"
        else if (row.status === "fail") found = "still_fails"
        else if (row.status === "inconclusive") found = "could_not_check"
        else found = row.status
      }
      resolution[found] += 1
      resolutionOf.set(cell, found)
    }

    const fresh = [...failsNow].filter((cell) => !baselineFails.has(cell))
    const failsNowCommon = [...failsNow].filter((cell) => commonCells.has(cell))
    const versions = [
      ...new Set(
        [...(rowsBefore?.values() ?? []), ...(rowsNow?.values() ?? [])].map((r) => r.rulesVersion),
      ),
    ]

    let state: ChangeState
    let reason: NotComparable | null = null
    let spread: FindingChange["spread"] = null
    let fixedHow: FindingChange["fixedHow"] = null
    let qualifier: FindingChange["qualifier"] = null
    let earlierFailure: FindingChange["earlierFailure"] = null

    if (input.ruleChanged(ruleId, versions)) {
      state = "not_comparable"
      reason = "rule_changed"
      changedRuleIds.push(ruleId)
    } else if (rowsBefore === undefined) {
      state = "not_comparable"
      reason = "rule_added"
    } else if (rowsNow === undefined) {
      state = "not_comparable"
      reason = "rule_removed"
    } else if (commonCells.size === 0) {
      state = "not_comparable"
      reason = "no_shared_scope"
    } else if (baselineFails.size > 0 && failsNow.size > 0) {
      state = "unchanged"
      const gone = resolution.pass + resolution.not_applicable + resolution.missing
      if (gone > 0) spread = fresh.length > 0 ? "moved" : "narrowed"
      else spread = fresh.length > 0 ? "widened" : "same"
    } else if (baselineFails.size > 0) {
      if (resolution.missing + resolution.consent_differs + resolution.banner_differs > 0) {
        state = "not_comparable"
        reason = "partly_rechecked"
      } else if (resolution.could_not_check > 0) state = "verdict_changed"
      else {
        state = "fixed"
        fixedHow = resolution.pass > 0 ? "passes" : "no_longer_applies"
      }
    } else if (failsNow.size > 0) {
      if (failsNowCommon.length === 0) {
        state = "not_comparable"
        reason = "no_shared_scope"
      } else {
        const unknown = failsNowCommon.filter((c) => rowsBefore.get(c)?.status === "inconclusive")
        if (unknown.length === failsNowCommon.length) state = "verdict_changed"
        else {
          if (unknown.length > 0) qualifier = "partly_unknown_before"
          earlierFailure = earlierFailureOf(ruleId, failsNowCommon, rowsBefore, versions, input)
          state = earlierFailure === null ? "new" : "regressed"
        }
      }
    } else {
      let changed = false
      let both = false
      for (const cell of commonCells) {
        const was = rowsBefore.get(cell)?.status === "inconclusive"
        const is = rowsNow.get(cell)?.status === "inconclusive"
        if (was && is) both = true
        else if (was !== is) changed = true
      }
      if (changed) state = "verdict_changed"
      else if (both) state = "unchanged"
      else continue
    }

    const listed: { cell: string; before: Verdict; now: Verdict | Resolution }[] = []
    for (const cell of fresh.toSorted(codeUnitOrder))
      listed.push({ cell, before: verdictOf(rowsBefore?.get(cell)?.status), now: "fail" })
    const resolved = [...resolutionOf].toSorted(([x], [y]) => codeUnitOrder(x, y))
    for (const stillFails of [true, false])
      for (const [cell, found] of resolved)
        if ((found === "still_fails") === stillFails)
          listed.push({ cell, before: "fail", now: found })
    const cap =
      state === "unchanged" && spread === "same" ? MAX_CELL_CHANGES_UNCHANGED : MAX_CELL_CHANGES
    const cellChanges = listed.slice(0, cap).flatMap(({ cell, before: was, now: is }) => {
      const key = (b.runByCell.get(cell) ?? n.runByCell.get(cell))?.cell
      if (key === undefined) return []
      let at = cellAt.get(cell)
      if (at === undefined) {
        at = cells.length
        cells.push(key)
        cellAt.set(cell, at)
      }
      return [{ cell: at, before: was, now: is }]
    })

    findings.push({
      ruleId,
      ...wording,
      state,
      reason,
      was: aggregate(rowsBefore?.values() ?? []),
      now: aggregate(rowsNow?.values() ?? []),
      fixedHow,
      spread,
      qualifier,
      resolution,
      cells: {
        common: commonCells.size,
        failedBefore: baselineFails.size,
        failedNow: failsNow.size,
        outside: [...failsNow].filter((cell) => !commonCells.has(cell)).length,
      },
      cellChanges,
      cellChangesTotal: listed.length,
      earlierFailure,
      triage: {
        before: before.triage.get(ruleId) ?? null,
        now: now.triage.get(ruleId) ?? OPEN,
      },
    })
  }

  findings.sort(
    (x, y) =>
      STATE_ORDER.indexOf(x.state) - STATE_ORDER.indexOf(y.state) ||
      SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity] ||
      codeUnitOrder(x.ruleId, y.ruleId),
  )
  const counts: Record<ChangeState, number> = {
    new: 0,
    regressed: 0,
    unchanged: 0,
    fixed: 0,
    verdict_changed: 0,
    not_comparable: 0,
  }
  for (const f of findings) counts[f.state] += 1
  const decodersBefore = decodersOf(before)
  const decodersNow = decodersOf(now)
  const comparability: Comparability = {
    commonCells: common,
    onlyBefore: before.runs.length - common,
    onlyNow: now.runs.length - common,
    rulesChanged: {
      from: versionsOfSide(before),
      to: versionsOfSide(now),
      ruleIds: changedRuleIds,
    },
    bannerDiffersCells: bannerDiffers,
    consentDiffersCells: consentDiffers,
    unevaluatedCellsBefore: before.runs.filter((r) => !checkedRuns.has(r.id)).length,
    decoderVersionsDiffer:
      decodersBefore.length !== decodersNow.length ||
      decodersBefore.some((d, i) => d !== decodersNow[i]),
  }
  return { cells, findings, counts, comparability }
}

/** A score delta needs the same scope and context on both sides; otherwise both scores and why not. */
export const scoreDeltaOf = (
  before: HealthScore,
  now: HealthScore,
  comparability: Comparability,
): ScoreLine => {
  const why = (): string | null => {
    if (!before.evaluated || !now.evaluated) return "One of the audits was not evaluated."
    if (before.coverage !== "full" || now.coverage !== "full")
      return "One of the audits was not fully evaluated."
    if (comparability.onlyBefore > 0 || comparability.onlyNow > 0)
      return "The audits did not check the same pages, scenarios and viewports."
    if (comparability.rulesChanged.ruleIds.length > 0)
      return "Some checks changed between the two rules versions."
    if (comparability.bannerDiffersCells > 0 || comparability.consentDiffersCells > 0)
      return "The cookie banner or the consent outcome differs between the audits."
    return null
  }
  const reason = why()
  let scoreVersion: number | null = null
  if (now.evaluated) scoreVersion = now.version
  else if (before.evaluated) scoreVersion = before.version
  return {
    before: before.evaluated ? before.score : null,
    now: now.evaluated ? now.score : null,
    delta: reason === null && before.evaluated && now.evaluated ? now.score - before.score : null,
    deltaWhyNot: reason,
    scoreVersion,
  }
}
