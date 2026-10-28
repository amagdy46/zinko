import type { ChangeState, Comparison } from "./compare"
import { changesBriefing } from "./compare-text"
import type { ConsultantPayload, DisclosureLevel, ReportModel } from "./report-model"
import { tagDestination, tagEvent, vendorLabel } from "./report-projection"
import type { TagDiff } from "./tag-diff"

const MAX_ITEMS = 12
const MAX_TAGS = 8
const MAX_LINE = 580

type ChangedState = "new" | "regressed" | "fixed" | "verdict_changed"
const CHANGED: ReadonlySet<ChangeState> = new Set(["new", "regressed", "fixed", "verdict_changed"])
const isChanged = (state: ChangeState): state is ChangedState => CHANGED.has(state)

const confirmationOf = (state: "repeated" | "not_repeated" | "incomplete" | undefined) =>
  state ?? ("none" as const)

const byText = (a: string, b: string) => (a < b ? -1 : Number(a > b))

/**
 * The report's "What changed", from the comparison after the author's exclusions: a finding left
 * out of the detail contributes nothing to the items, the lines or the counts (it only adds to
 * `omitted`). Built from stored wording, counts and enums; it names no page, since page aliases
 * mean different pages in two audits. Also the consultant's list of changes, hidden ones included.
 */
export function changesOf(input: {
  comparison: Comparison
  tags: TagDiff
  hidden: ReadonlySet<string>
  detail: DisclosureLevel
}): { changes: NonNullable<ReportModel["changes"]>; rows: ReadonlyArray<ChangeRow> } {
  const { comparison, tags, hidden, detail } = input
  const visible = comparison.findings.filter((f) => !hidden.has(f.ruleId))
  const count = (state: ChangeState) => visible.filter((f) => f.state === state).length
  const counts = {
    new: count("new"),
    regressed: count("regressed"),
    unchanged: count("unchanged"),
    fixed: count("fixed"),
    verdict_changed: count("verdict_changed"),
    not_comparable: count("not_comparable"),
  }
  const k = comparison.comparability
  const gone = tags.changes
    .filter((c) => c.change === "disappeared" && c.cellsAffected === c.cellsCompared)
    .map((c) => {
      const destination = tagDestination(c.vendor, c.destinationId, detail)
      return destination === null
        ? vendorLabel(c.vendor)
        : `${vendorLabel(c.vendor)} ${destination}`
    })
  const lines = changesBriefing({ ...comparison, findings: visible, counts }, gone).map((line) =>
    line.length > MAX_LINE ? `${line.slice(0, MAX_LINE - 1)}…` : line,
  )
  const notices: NonNullable<ReportModel["changes"]>["notices"][number][] = []
  if (k.rulesChanged.ruleIds.length > 0) notices.push("rules_changed")
  if (k.onlyBefore > 0 || k.onlyNow > 0) notices.push("scope_differs")
  if (k.bannerDiffersCells > 0) notices.push("banner_differs")
  if (k.consentDiffersCells > 0) notices.push("consent_differs")
  if (
    comparison.score.delta === null &&
    comparison.score.before !== null &&
    comparison.score.now !== null
  )
    notices.push("score_not_comparable")
  const rows = comparison.findings.flatMap((f) =>
    isChanged(f.state)
      ? [{ ruleId: f.ruleId, title: f.title, state: f.state, hidden: hidden.has(f.ruleId) }]
      : [],
  )
  return {
    changes: {
      baselineDate: comparison.before.createdAt,
      counts: {
        new: counts.new,
        regressed: counts.regressed,
        fixed: counts.fixed,
        unchanged: counts.unchanged,
        verdictChanged: counts.verdict_changed,
        notComparable: counts.not_comparable,
      },
      omitted: rows.filter((r) => r.hidden).length,
      score: {
        before: comparison.score.before,
        now: comparison.score.now,
        delta: comparison.score.delta,
      },
      items: visible
        .flatMap((f) =>
          isChanged(f.state)
            ? [
                {
                  ruleId: f.ruleId,
                  state: f.state,
                  severity: f.severity,
                  title: f.title,
                  pages: f.pages.changed,
                  pagesCompared: f.pages.compared,
                  confidence: f.confidence.level,
                  confirmation: confirmationOf(f.confirmation?.state),
                  qualifier: f.qualifier,
                },
              ]
            : [],
        )
        .slice(0, MAX_ITEMS),
      tags: tags.changes.slice(0, MAX_TAGS).map((c) => ({
        change: c.change,
        vendor: vendorLabel(c.vendor),
        destination: tagDestination(c.vendor, c.destinationId, detail),
        eventsAdded: [...new Set(c.eventsAdded.map((e) => tagEvent(c.vendor, e)))].toSorted(byText),
        eventsRemoved: [...new Set(c.eventsRemoved.map((e) => tagEvent(c.vendor, e)))].toSorted(
          byText,
        ),
        cellsAffected: c.cellsAffected,
        cellsCompared: c.cellsCompared,
      })),
      notices,
      lines,
    },
    rows,
  }
}

export type ChangeRow = NonNullable<ConsultantPayload["changeRows"]>["items"][number]
