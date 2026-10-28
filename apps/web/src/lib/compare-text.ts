import { scenarioLabel } from "./audit-labels"
import type {
  CellKey,
  ChangeState,
  Comparison,
  FindingChange,
  NotComparable,
  Resolution,
  Verdict,
} from "./compare"
import { count } from "./format"

/** The words of a change, shared by the Compare tab and (later) the briefing and the report. */
export const CHANGE_WORDS: Record<ChangeState, string> = {
  new: "New",
  regressed: "Regressed",
  fixed: "Fixed",
  unchanged: "Unchanged",
  verdict_changed: "Verdict changed",
  not_comparable: "Not comparable",
}

/** The order the Compare tab groups changes in. */
export const CHANGE_ORDER: ReadonlyArray<ChangeState> = [
  "regressed",
  "new",
  "verdict_changed",
  "fixed",
  "unchanged",
  "not_comparable",
]

const SPREAD_WORDS = {
  same: "Fails on the same runs.",
  narrowed: "Fails on fewer runs.",
  widened: "Fails on more runs.",
  moved: "Fails on other runs now: some are resolved, others are new.",
} as const

export const VERDICT_WORDS: Record<Verdict | Resolution, string> = {
  fail: "Fail",
  still_fails: "Fail",
  could_not_check: "Could not check",
  pass: "Pass",
  not_applicable: "Not applicable",
  not_run: "Not in this audit",
  missing: "Not re-checked",
  consent_differs: "Consent choice differed",
  banner_differs: "Cookie banner differed",
}

export const verdictMeaning = (verdict: Verdict | Resolution) => {
  if (verdict === "fail" || verdict === "still_fails") return "fail" as const
  if (verdict === "pass") return "pass" as const
  if (verdict === "could_not_check") return "could-not-check" as const
  return "not-applicable" as const
}

/** "/drift/product", with "Journey from" for a journey and "(test click IDs)" for an injected start page. */
export const cellPage = (cell: CellKey) => {
  const url = URL.canParse(cell.page) ? new URL(cell.page) : null
  const path = url === null ? cell.page : `${url.pathname}${url.search}`
  const label = cell.itinerary === null ? path : `Journey from ${path}`
  return cell.injected ? `${label} (test click IDs)` : label
}

export const cellScenario = (cell: CellKey) => scenarioLabel(cell.scenario)

const NOT_COMPARABLE_WORDS: Record<NotComparable, string> = {
  rule_changed:
    "This check changed between the two rules versions, so the two results are not alike.",
  rule_added: "This check was not run in the earlier audit.",
  rule_removed: "This check was not run in this audit.",
  no_shared_scope: "No page, scenario and viewport was checked in both audits.",
  partly_rechecked: "",
}

const resolutionParts = (f: FindingChange) => {
  const r = f.resolution
  const parts = [
    r.pass + r.not_applicable > 0 && `passing on ${count(r.pass + r.not_applicable, "run")}`,
    r.could_not_check > 0 && `${count(r.could_not_check, "run")} could not be checked`,
    r.missing > 0 && `${count(r.missing, "run")} not re-checked`,
    r.consent_differs > 0 && `${count(r.consent_differs, "run")} with another consent choice`,
    r.banner_differs > 0 && `${count(r.banner_differs, "run")} with another banner result`,
  ]
  return parts.filter((part) => part !== false)
}

const verdictChangedLine = (f: FindingChange) => {
  if (f.cells.failedNow > 0)
    return `Now fails on ${count(f.cells.failedNow, "run")}; it could not be checked there before.`
  if (f.cells.failedBefore > 0)
    return `Failed on ${count(f.cells.failedBefore, "run")} before; it can no longer be checked there.`
  return "A check that could not run before now has a result, or the other way round."
}

const LINES: Record<ChangeState, (f: FindingChange) => string> = {
  new: (f) =>
    f.qualifier === null
      ? `Fails on ${count(f.cells.failedNow, "run")}; it did not fail on these runs before.`
      : `Fails on ${count(f.cells.failedNow, "run")}; some could not be checked before.`,
  regressed: (f) => `Fails on ${count(f.cells.failedNow, "run")}; it passed in the last audit.`,
  fixed: (f) =>
    `${failedLine(f)}. ${f.fixedHow === "no_longer_applies" ? "It no longer applies" : "It passes now"} on every run that failed.`,
  unchanged: (f) =>
    f.spread === null
      ? `Could not be checked on the same runs as before (${count(f.cells.common, "run")} compared).`
      : `${failedLine(f)}. ${SPREAD_WORDS[f.spread]}`,
  verdict_changed: verdictChangedLine,
  not_comparable: (f) =>
    f.reason === "partly_rechecked"
      ? `${failedLine(f)}. Re-checked: ${resolutionParts(f).join("; ")}. Not fixed until every run that failed is checked again.`
      : NOT_COMPARABLE_WORDS[f.reason ?? "no_shared_scope"],
}

const failedLine = (f: FindingChange) =>
  `Failed on ${count(f.cells.failedBefore, "run")} before, ${f.cells.failedNow} now`

/** Where the finding failed before and now, then why the state is what it is. */
export const changeLine = (f: FindingChange) => LINES[f.state](f)

/** The triage mark of the earlier audit, when it matters to a reader of the change. */
export const triageLine = (f: FindingChange, shortDate: (iso: string) => string) => {
  const { before, now } = f.triage
  if (before?.status === "fixed" && f.state !== "fixed" && f.now === "fail")
    return `Marked fixed${before.at === null ? "" : ` on ${shortDate(before.at)}`}, still fails.`
  if (before?.status === "fixed" && f.state === "fixed")
    return "Marked fixed, and the re-run confirms it."
  if (now.status === "accepted_risk") return "Accepted risk."
  return null
}

/** What limits the comparison, one entry each, in the order a reader should weigh them. */
export const noticesOf = (c: Comparison) => {
  const { comparability: k } = c
  const notices: string[] = []
  if (k.rulesChanged.ruleIds.length > 0)
    notices.push(
      `Rules version ${k.rulesChanged.from.join(", ")} to ${k.rulesChanged.to.join(", ")}: ${count(k.rulesChanged.ruleIds.length, "check")} changed and cannot be compared.`,
    )
  else if (k.rulesChanged.from.join() !== k.rulesChanged.to.join())
    notices.push(
      `Rules version ${k.rulesChanged.from.join(", ")} to ${k.rulesChanged.to.join(", ")}: no check you can see changed its result.`,
    )
  const total = k.commonCells + k.onlyBefore + k.onlyNow
  if (k.onlyBefore > 0 || k.onlyNow > 0)
    notices.push(
      `The audits share ${k.commonCells} of ${total} runs (page, scenario and viewport). ${k.onlyBefore} were only in the earlier audit and ${k.onlyNow} only in this one.`,
    )
  if (k.bannerDiffersCells > 0)
    notices.push(
      `The cookie banner was found on one audit and not on the other for ${count(k.bannerDiffersCells, "run")}.`,
    )
  if (k.consentDiffersCells > 0)
    notices.push(
      `A consent choice was applied in one audit and not in the other for ${count(k.consentDiffersCells, "run")}.`,
    )
  if (k.unevaluatedCellsBefore > 0)
    notices.push(
      `${count(k.unevaluatedCellsBefore, "run")} of the earlier audit were not evaluated.`,
    )
  if (k.decoderVersionsDiffer) notices.push("The tag decoders differ between the two audits.")
  notices.push(
    "Where the audits ran from is not recorded, so a difference by country cannot be seen.",
  )
  return notices
}

/** True when nothing a reader needs to act on changed: every finding fails (or not) on the same runs as before. */
export const nothingChanged = (c: Comparison) =>
  c.findings.every(
    (f) =>
      f.state === "unchanged" &&
      f.spread !== "narrowed" &&
      f.spread !== "widened" &&
      f.spread !== "moved",
  )
