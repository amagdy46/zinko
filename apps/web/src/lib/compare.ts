import { type AuditConfig, JOURNEY_STEPS, TEST_CLICK_IDS } from "@repo/core/audit"
import { ambiguousClickIdPages, pageIndexOf } from "@/lib/page-match"
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

/** A journey run walks the key pages; a cross-host run only follows a link from the start URL to its host. */
const itineraryOf = (
  run: { journey: boolean; followHost?: string | null },
  start: string,
  pages: ReadonlyArray<string>,
) => {
  if (run.followHost !== undefined && run.followHost !== null)
    return [normalised(start), `follow ${run.followHost}`]
  return run.journey ? [start, ...pages.slice(1, 1 + JOURNEY_STEPS)].map(normalised) : null
}

export const cellKeyOf = (
  run: {
    pageUrl: string
    scenario: string
    viewport: string
    journey: boolean
    followHost?: string | null
  },
  config: { pages: ReadonlyArray<string>; clickIdPages?: ReadonlyArray<string> | undefined },
): CellKey => {
  const injected = injectionOf(run.pageUrl)
  const [start = run.pageUrl] = config.pages
  // an audit made before `clickIdPages` injected the start page only; `createAudit` refuses pages
  // that only the test IDs tell apart, so with the list an injected run names exactly one page
  const configured =
    injected && config.clickIdPages !== undefined
      ? config.pages[pageIndexOf(config.pages, run.pageUrl)]
      : undefined
  return {
    page: normalised(configured ?? (injected ? start : run.pageUrl)),
    scenario: run.scenario,
    viewport: run.viewport,
    itinerary: itineraryOf(run, start, config.pages),
    injected,
  }
}

export const cellId = (k: CellKey) =>
  JSON.stringify([k.page, k.scenario, k.viewport, k.itinerary, k.injected])

export interface CellRun {
  id: string
  cell: CellKey
  compat: Compat
  decoder: string | null
  /** The run captured completely. */
  complete: boolean
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
  /** Distinct pages the change is on, and the pages compared for this rule (aliases differ between audits, so only counts). */
  pages: { changed: number; compared: number; outside: number }
  /** `cell` indexes `Comparison.cells`. A finding that fails on the same cells as before lists only a few. */
  cellChanges: { cell: number; before: Verdict; now: Verdict | Resolution }[]
  cellChangesTotal: number
  earlierFailure: { auditId: string; date: string; startPath: string } | null
  /** Low confidence never changes the state; it adds a label and the Re-check action. */
  confidence: { level: "normal" | "low"; because: ("volatile_rule" | "flips" | "single_run")[] }
  /** What a later re-check of these cells (a narrow audit) found; null when none covers them. */
  confirmation: {
    state: "repeated" | "not_repeated" | "incomplete"
    auditId: string
    cellsDone: number
    cellsTotal: number
  } | null
  triage: { before: TriageLine | null; now: TriageLine }
}

export interface AuditRef {
  id: string
  createdAt: string
  status: string
  /** The path of the audit's start page, so audits of one site tell apart (see `auditName`). */
  startPath: string
}

export interface Comparability {
  commonCells: number
  onlyBefore: number
  onlyNow: number
  rulesChanged: { from: string[]; to: string[]; ruleIds: string[] }
  bannerDiffersCells: number
  consentDiffersCells: number
  unevaluatedCellsBefore: number
  unevaluatedCellsNow: number
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
  startPath: string
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
/** Cells that still fail or were not re-checked come before the ones that passed. */
const RESOLUTION_RANK: Record<Resolution, number> = {
  still_fails: 0,
  consent_differs: 1,
  banner_differs: 1,
  missing: 2,
  could_not_check: 3,
  pass: 4,
  not_applicable: 4,
}
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

/** A finished re-check (a narrow audit) of one rule on some cells. */
export interface ConfirmationAudit {
  auditId: string
  ruleId: string
  targets: ReadonlyArray<CellKey>
  runs: ReadonlyArray<CellRun>
  checks: ReadonlyArray<CheckRow>
}

interface Input {
  before: Side
  now: Side
  history: ReadonlyArray<HistoryAudit>
  /** Newest first. */
  confirmations: ReadonlyArray<ConfirmationAudit>
  volatile: ReadonlySet<string>
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
  nowRuns: ReadonlyMap<string, CellRun>,
): FindingChange["earlierFailure"] => {
  const eligible = new Set(
    failingNow.filter((cell) => {
      const status = rowsBefore.get(cell)?.status
      return status === "pass" || status === "not_applicable"
    }),
  )
  for (const audit of input.history) {
    const runById = new Map(audit.runs.map((r) => [r.id, r]))
    for (const row of audit.checks) {
      if (row.ruleId !== ruleId || row.status !== "fail") continue
      const witness = runById.get(row.runId)
      if (witness === undefined) continue
      const cell = cellId(witness.cell)
      const current = nowRuns.get(cell)
      if (current === undefined || !eligible.has(cell)) continue
      // a witness counts only when its consent choice and banner agree with the current run's
      if (compatDiffers(ruleId, witness, current, input.bannerDependent) !== null) continue
      if (input.ruleChanged(ruleId, [row.rulesVersion, ...currentVersions])) continue
      return { auditId: audit.auditId, date: audit.date, startPath: audit.startPath }
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

/** Distinct pages the change is on where both audits ran, the pages compared, and the changed pages only one audit had. */
const pagesOf = (
  changed: ReadonlySet<string>,
  common: ReadonlySet<string>,
  runOf: (cell: string) => CellRun | undefined,
) => {
  const pageOf = (cell: string) => runOf(cell)?.cell.page ?? []
  const comparedPages = new Set([...common].flatMap(pageOf))
  const changedOnCompared = new Set([...changed].filter((c) => common.has(c)).flatMap(pageOf))
  const changedOutside = new Set([...changed].filter((c) => !common.has(c)).flatMap(pageOf))
  return {
    changed: changedOnCompared.size,
    compared: comparedPages.size,
    outside: [...changedOutside].filter((page) => !comparedPages.has(page)).length,
  }
}

/** Audits looked at for flips, counting the two being compared. */
const FLIP_AUDITS = 5

/** Whether the rule failed on any of the cells in that audit; null when the audit has no row on them. */
const failedOnCells = (
  cells: ReadonlySet<string>,
  rows: ReadonlyArray<{ cell: string; status: CheckRow["status"] }>,
) => {
  const own = rows.filter((r) => cells.has(r.cell))
  return own.length === 0 ? null : own.some((r) => r.status === "fail")
}

/** How many times the fail / not-fail answer on these cells changes over the last audits, oldest first. */
const flipsOf = (
  ruleId: string,
  cells: ReadonlySet<string>,
  sides: ReadonlyArray<ReadonlyArray<{ cell: string; status: CheckRow["status"] }>>,
  history: ReadonlyArray<HistoryAudit>,
) => {
  const older = history.slice(0, FLIP_AUDITS - 2).map((audit) => {
    const cellByRun = new Map(audit.runs.map((r) => [r.id, cellId(r.cell)]))
    return audit.checks.flatMap((row) => {
      const cell = cellByRun.get(row.runId)
      return row.ruleId === ruleId && cell !== undefined ? [{ cell, status: row.status }] : []
    })
  })
  const answers = [...sides, ...older]
    .map((rows) => failedOnCells(cells, rows))
    .filter((answer) => answer !== null)
    .toReversed()
  return answers.filter((answer, i) => i > 0 && answer !== answers[i - 1]).length
}

/**
 * What the newest re-check that covers every cell of the change found there: it reproduces the
 * change when its verdict on a cell equals the current audit's, and counts only cells whose run
 * captured completely, agrees on consent and banner, and has a check result for the rule.
 */
const confirmationOf = (
  ruleId: string,
  changed: ReadonlySet<string>,
  expectFail: ReadonlyMap<string, boolean>,
  refRuns: ReadonlyMap<string, CellRun>,
  currentVersions: readonly string[],
  input: Input,
): FindingChange["confirmation"] => {
  if (changed.size === 0) return null
  const found = input.confirmations.find(
    (c) =>
      c.ruleId === ruleId &&
      [...changed].every((cell) => c.targets.some((t) => cellId(t) === cell)),
  )
  if (found === undefined) return null
  const runByCell = new Map(found.runs.map((r) => [cellId(r.cell), r]))
  const rowByRun = new Map(found.checks.filter((c) => c.ruleId === ruleId).map((c) => [c.runId, c]))
  let done = 0
  let repeated = 0
  let contradicted = 0
  for (const cell of changed) {
    const rerun = runByCell.get(cell)
    const row = rerun === undefined ? undefined : rowByRun.get(rerun.id)
    const reference = refRuns.get(cell)
    // only a determinate verdict (not Could not check) of a run that captured completely, judged
    // by a comparable rules version, says anything about the change
    if (rerun === undefined || row === undefined || !rerun.complete) continue
    if (row.status === "inconclusive") continue
    if (input.ruleChanged(ruleId, [row.rulesVersion, ...currentVersions])) continue
    if (
      reference !== undefined &&
      compatDiffers(ruleId, reference, rerun, input.bannerDependent) !== null
    )
      continue
    done += 1
    const expected = expectFail.get(cell)
    if (expected === undefined) continue
    if ((row.status === "fail") === expected) repeated += 1
    else contradicted += 1
  }
  let state: "repeated" | "not_repeated" | "incomplete" = "incomplete"
  if (done === changed.size && repeated === done) state = "repeated"
  else if (done === changed.size && contradicted === done) state = "not_repeated"
  return { state, auditId: found.auditId, cellsDone: done, cellsTotal: changed.size }
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
  const checkedNow = new Set(now.checks.map((c) => c.runId))

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
    // common cells where only the verdict changed to or from Could not check
    const shown: string[] = []

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
          earlierFailure = earlierFailureOf(
            ruleId,
            failsNowCommon,
            rowsBefore,
            versions,
            input,
            n.runByCell,
          )
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
        if (was || is) shown.push(cell)
      }
      if (changed) state = "verdict_changed"
      else if (both) state = "unchanged"
      else continue
    }

    const listed: { cell: string; before: Verdict; now: Verdict | Resolution }[] = []
    for (const cell of fresh.toSorted(codeUnitOrder))
      listed.push({ cell, before: verdictOf(rowsBefore?.get(cell)?.status), now: "fail" })
    for (const cell of shown.toSorted(codeUnitOrder))
      listed.push({
        cell,
        before: verdictOf(rowsBefore?.get(cell)?.status),
        now: verdictOf(rowsNow?.get(cell)?.status),
      })
    const resolved = [...resolutionOf].toSorted(
      ([x, ra], [y, rb]) => RESOLUTION_RANK[ra] - RESOLUTION_RANK[rb] || codeUnitOrder(x, y),
    )
    for (const [cell, found] of resolved) listed.push({ cell, before: "fail", now: found })
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

    const changedCells = new Set<string>([...baselineFails, ...failsNow, ...shown])
    const expectFail = new Map<string, boolean>()
    for (const cell of changedCells) {
      const status = rowsNow?.get(cell)?.status
      if (status !== undefined && status !== "inconclusive") expectFail.set(cell, status === "fail")
      else if (state === "fixed") expectFail.set(cell, false)
    }
    const refRuns = new Map<string, CellRun>()
    for (const cell of changedCells) {
      const reference = n.runByCell.get(cell) ?? b.runByCell.get(cell)
      if (reference !== undefined) refRuns.set(cell, reference)
    }
    const because: FindingChange["confidence"]["because"] = []
    const judged = state !== "unchanged" && state !== "not_comparable"
    if (judged) {
      if (input.volatile.has(ruleId)) because.push("volatile_rule")
      const toRows = (rows: RuleRows | undefined) =>
        [...(rows ?? [])].map(([cell, row]) => ({ cell, status: row.status }))
      if (flipsOf(ruleId, changedCells, [toRows(rowsNow), toRows(rowsBefore)], input.history) >= 2)
        because.push("flips")
      if (changedCells.size === 1) because.push("single_run")
    }
    const confirmation = judged
      ? confirmationOf(ruleId, changedCells, expectFail, refRuns, versions, input)
      : null

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
      pages: pagesOf(
        changedCells,
        commonCells,
        (cell) => b.runByCell.get(cell) ?? n.runByCell.get(cell),
      ),
      cellChanges,
      cellChangesTotal: listed.length,
      earlierFailure,
      confidence: { level: because.length > 0 ? "low" : "normal", because },
      confirmation,
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
    unevaluatedCellsNow: now.runs.filter((r) => !checkedNow.has(r.id)).length,
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

/** The cells a rule fails on in the audit, and in the earlier one when there is a comparison. */
export const recheckTargets = (
  sides: { before: Side | null; now: Side },
  ruleId: string,
): CellKey[] => {
  const found = new Map<string, CellKey>()
  for (const side of [sides.now, ...(sides.before === null ? [] : [sides.before])]) {
    const { runByCell, rows } = index(side)
    for (const [cell, row] of rows.get(ruleId) ?? [])
      if (row.status === "fail") {
        const key = runByCell.get(cell)?.cell
        if (key !== undefined) found.set(cell, key)
      }
  }
  return [...found].toSorted(([x], [y]) => codeUnitOrder(x, y)).map(([, key]) => key)
}

type ConfigShape = Pick<AuditConfig, "pages" | "scenarios" | "viewports" | "clickIds"> & {
  clickIdPages?: ReadonlyArray<string> | undefined
  journey?: boolean | undefined
  crossHost?: boolean | undefined
  measuredHosts?: ReadonlyArray<string> | undefined
}

/** Whether the page at `index` is captured with the test click IDs: the start page by `clickIds`, any page named in `clickIdPages`. */
export const carriesClickIds = (config: ConfigShape, at: number) => {
  const page = config.pages[at]
  return (
    page !== undefined &&
    ((at === 0 && config.clickIds) ||
      (config.clickIdPages ?? []).some((p) => normalised(p) === normalised(page)))
  )
}

/** Every cell an audit with this config runs: its plain runs, its journey runs, then its cross-host runs. */
export const cellsOfConfig = (config: ConfigShape): CellKey[] => {
  const [start] = config.pages
  const plain = config.pages.flatMap((page, p) =>
    config.scenarios.flatMap((scenario) =>
      config.viewports.map((viewport) => ({
        page: normalised(page),
        scenario,
        viewport,
        itinerary: null,
        injected: carriesClickIds(config, p),
      })),
    ),
  )
  const [firstViewport] = config.viewports
  const crossHost =
    config.crossHost === true && start !== undefined && firstViewport !== undefined
      ? (config.measuredHosts ?? []).map((host) => ({
          page: normalised(start),
          scenario: "accept",
          viewport: firstViewport,
          itinerary: [normalised(start), `follow ${host}`],
          injected: carriesClickIds(config, 0),
        }))
      : []
  if (config.journey !== true || config.pages.length < 2 || start === undefined)
    return [...plain, ...crossHost]
  const itinerary = [start, ...config.pages.slice(1, 1 + JOURNEY_STEPS)].map(normalised)
  return [
    ...plain,
    ...config.scenarios.flatMap((scenario) =>
      config.viewports.map((viewport) => ({
        page: normalised(start),
        scenario,
        viewport,
        itinerary,
        injected: carriesClickIds(config, 0),
      })),
    ),
    ...crossHost,
  ]
}

/** Two configs are comparable when they run exactly the same cells: pages, scenarios and viewports (and the journey and hosts they add). */
export const sameScope = (a: ConfigShape, b: ConfigShape) => {
  const ids = new Set(cellsOfConfig(a).map(cellId))
  const other = cellsOfConfig(b).map(cellId)
  return ids.size === other.length && other.every((id) => ids.has(id))
}

const SCENARIO_ORDER = ["none", "accept", "reject", "gpc"] as const
const VIEWPORT_ORDER = ["desktop", "mobile"] as const

export interface NarrowPlan {
  config: AuditConfig
  /** The targets the narrowed config can reproduce. */
  targets: CellKey[]
  /** Runs executed only to detect the cookie banner for a `none` target. */
  companions: CellKey[]
  /** Targets the current configuration cannot reproduce as they were captured. */
  dropped: CellKey[]
}

/** The host a cross-host cell follows a link to, or `undefined` for any other cell. */
export const followHostOf = (cell: CellKey): string | undefined =>
  cell.itinerary?.find((step) => step.startsWith("follow "))?.slice("follow ".length)

const narrowedOnce = (
  config: AuditConfig,
  targets: ReadonlyArray<CellKey>,
  bannerDependent: boolean,
  declared: ReadonlyArray<string>,
): AuditConfig | null => {
  // a cross-host cell is reproduced by `crossHost`, not by walking the key pages
  const journey = targets.some((t) => t.itinerary !== null && followHostOf(t) === undefined)
  const followed = [
    ...new Set(
      targets.flatMap((t) => {
        const host = followHostOf(t)
        return host === undefined || !declared.includes(host) ? [] : [host]
      }),
    ),
  ]
  const wanted = new Set(targets.map((t) => t.page))
  const pages = journey ? config.pages : config.pages.filter((p) => wanted.has(normalised(p)))
  const [first] = pages
  if (first === undefined) return null
  const companions = bannerDependent && targets.some((t) => t.scenario === "none")
  const clickIdPages = pages.filter(
    (p, i) =>
      !(i === 0 && normalised(p) === normalised(config.pages[0] ?? "")) &&
      targets.some((t) => t.injected && t.page === normalised(p)),
  )
  return {
    pages,
    scenarios: SCENARIO_ORDER.filter(
      (scenario) =>
        targets.some((t) => t.scenario === scenario) ||
        (companions && (scenario === "accept" || scenario === "reject")),
    ),
    viewports: VIEWPORT_ORDER.filter((viewport) => targets.some((t) => t.viewport === viewport)),
    clickIds:
      normalised(first) === normalised(config.pages[0] ?? "") &&
      targets.some((t) => t.injected && t.page === normalised(first)),
    ...(clickIdPages.length > 0 ? { clickIdPages } : {}),
    blockVendorRequests: config.blockVendorRequests,
    ...(journey && pages.length > 1 ? { journey: true } : {}),
    // the hosts a re-check follows are the declared ones among its targets, a snapshot like any audit's
    ...(followed.length > 0 ? { crossHost: true, measuredHosts: followed } : {}),
  }
}

const clashingPages = (config: ConfigShape) => {
  const clashing = new Set<string>()
  if ((config.clickIdPages ?? []).length === 0) return clashing
  for (let i = 0; i < config.pages.length; i++) {
    for (let j = i + 1; j < config.pages.length; j++) {
      const pair = ambiguousClickIdPages([config.pages[i] ?? "", config.pages[j] ?? ""], (k) =>
        carriesClickIds(config, k === 0 ? i : j),
      )
      if (pair !== null) {
        clashing.add(normalised(config.pages[i] ?? ""))
        clashing.add(normalised(config.pages[j] ?? ""))
      }
    }
  }
  return clashing
}

/**
 * The config of a re-check of `targets`: their scenarios and viewports, their pages in the audit's
 * order (the whole list for a journey), click IDs on the start page when it is a target that had them and on each key page whose target had them,
 * and accept and reject runs beside every `none` target of a banner-dependent rule. The result is
 * checked against `cellsOfConfig`: a target it cannot reproduce is dropped, never silently moved.
 * A cross-host target is kept only while its host is still one of the site's `declared` hosts.
 */
export const narrowedConfig = (
  config: AuditConfig,
  targets: ReadonlyArray<CellKey>,
  bannerDependent: boolean,
  declared: ReadonlyArray<string>,
): NarrowPlan | null => {
  // The config is built from the targets still kept. A config runs a page either with the click IDs
  // or without, and `createAudit` refuses pages that only campaign parameters tell apart while one
  // carries them. So a target that is not reproduced, or that is injected on a clashing page, is
  // resolved first by dropping an injected target involved (a plain target wins over an injected
  // one on the same page), and only if none is left, the unreproduced target itself; one at a time,
  // in a fixed order, so the others are reconsidered against the rebuilt config.
  // Every original target the final config reproduces is then retained, the rest are dropped.
  const evaluate = (kept: ReadonlyArray<CellKey>) => {
    const narrowed = narrowedOnce(config, kept, bannerDependent, declared)
    if (narrowed === null) return null
    const produced = new Set(cellsOfConfig(narrowed).map(cellId))
    const clashing = clashingPages(narrowed)
    return {
      narrowed,
      produced,
      reproduced: (t: CellKey) => produced.has(cellId(t)) && !(t.injected && clashing.has(t.page)),
    }
  }
  let kept = [...targets]
  let found = evaluate(kept)
  while (found !== null) {
    const { reproduced } = found
    const failing = kept.filter((t) => !reproduced(t))
    if (failing.length === 0) break
    const failingPages = new Set(failing.map((t) => t.page))
    const injected = kept.filter((t) => t.injected && failingPages.has(t.page))
    const [victim] = (injected.length > 0 ? injected : failing).toSorted((x, y) =>
      codeUnitOrder(cellId(y), cellId(x)),
    )
    kept = kept.filter((t) => t !== victim)
    found = evaluate(kept)
  }
  // a target dropped early may be reproducible once later ones are gone: take each back that fits
  for (let changed = true; changed && found !== null;) {
    changed = false
    for (const t of targets.filter((x) => !kept.includes(x))) {
      const trial = evaluate([...kept, t])
      if (trial !== null && [...kept, t].every(trial.reproduced)) {
        kept = [...kept, t]
        found = trial
        changed = true
      }
    }
  }
  if (found === null) return null
  const { narrowed, produced, reproduced } = found
  const retained = targets.filter(reproduced)
  const companions = bannerDependent
    ? retained
        .filter((t) => t.scenario === "none")
        .flatMap((t) =>
          ["accept", "reject"].map((scenario): CellKey => ({
            page: t.page,
            scenario,
            viewport: t.viewport,
            itinerary: t.itinerary,
            injected: t.injected,
          })),
        )
        .filter((c) => !retained.some((t) => cellId(t) === cellId(c)))
    : []
  return {
    config: narrowed,
    targets: retained,
    companions: companions.filter((c) => produced.has(cellId(c))),
    dropped: targets.filter((t) => !reproduced(t)),
  }
}
