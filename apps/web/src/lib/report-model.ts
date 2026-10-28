import { Data, Effect, Schema } from "effect"
import { count } from "./format"
import { ACCENTS } from "./report-accent"

/**
 * The shape of `ReportModel` as stored in a snapshot. A change to the model bumps this and adds a
 * step to `UPGRADES`, so snapshots published earlier keep rendering (a shared link is a dated
 * record that a client may open months later).
 */
export const REPORT_MODEL_VERSION = 4

/** An array that is never empty in a report: an emptied one is a defect, not "nothing to show". */
const Some = <S extends Schema.Top>(item: S) => Schema.Array(item).check(Schema.isMinLength(1))

const Count = Schema.Int
const Amount = Schema.Finite
const Severity = Schema.Literals(["critical", "warning", "info"])
const OwnerId = Schema.Literals(["consent-platform", "tag-manager", "developer"])
export type OwnerId = typeof OwnerId.Type

/** Who usually fixes a failing rule, in words; the labels live here because the client must not import the rules. */
export const OWNER_LABELS: Record<OwnerId, string> = {
  "consent-platform": "Consent platform admin",
  "tag-manager": "Tag manager or marketing",
  developer: "Site developer",
}

const Detail = Schema.Literals(["standard", "detailed"])
const Band = Schema.Literals(["critical", "attention", "minor", "no-failures"])
const ConsentState = Schema.Literals(["granted", "denied", "unknown"])

const ScoreLine = Schema.Struct({
  ruleId: Schema.String,
  title: Schema.String,
  severity: Severity,
  failing: Count,
  known: Count,
  points: Amount,
  bannerUncertain: Count,
})

/** The `HealthScore` of an evaluated audit: a report exists only for one. */
const Score = Schema.Struct({
  evaluated: Schema.Literal(true),
  version: Count,
  score: Count,
  band: Band,
  coverage: Schema.Literals(["full", "partial"]),
  resolution: Schema.Literals(["resolved", "unresolved"]),
  lines: Schema.Array(ScoreLine),
  total: Amount,
  capped: Schema.Boolean,
  uncertainty: Schema.Struct({
    checks: Count,
    runs: Count,
    rules: Count,
    ruleTitles: Schema.Array(Schema.String),
    bannerUncertainRuns: Count,
  }),
  versions: Some(Schema.String),
  mixedVersions: Schema.Boolean,
})

const ConsentCell = Schema.Struct({
  scenario: Schema.String,
  runs: Schema.Struct({ total: Count, complete: Count, partial: Count, none: Count }),
  outcomes: Schema.Array(Schema.Struct({ outcome: Schema.String, runs: Count })),
  runsWithHits: Count,
  hits: Count,
  choice: Schema.Struct({ observed: Count, hitsBefore: Count, hitsAfter: Count }),
})

const ConsentRow = Schema.Struct({ vendor: Schema.String, cells: Schema.Array(ConsentCell) })

const EvidenceRow = Schema.Struct({
  kind: Schema.Literals(["hit", "request", "cookie", "push", "document"]),
  vendor: Schema.NullOr(Schema.String),
  event: Schema.NullOr(Schema.String),
  destination: Schema.NullOr(Schema.String),
  timing: Schema.NullOr(Schema.Literals(["before-choice", "after-choice", "no-choice"])),
  adStorage: Schema.NullOr(ConsentState),
  analyticsStorage: Schema.NullOr(ConsentState),
  category: Schema.NullOr(Schema.Literals(["consent-ping", "collection", "other"])),
  status: Schema.NullOr(Count),
  blocked: Schema.NullOr(Schema.Boolean),
  cookie: Schema.NullOr(Schema.String),
  command: Schema.NullOr(Schema.String),
  redirects: Schema.NullOr(Count),
})

export const ReportFinding = Schema.Struct({
  ruleId: Schema.String,
  severity: Severity,
  area: Schema.String,
  title: Schema.String,
  why: Schema.String,
  fix: Schema.Array(Schema.String),
  owner: Schema.NullOr(OwnerId),
  ownerSource: Schema.Literals(["rule", "author", "none"]),
  failingRuns: Count,
  knownRuns: Count,
  pages: Schema.Array(Schema.String),
  scenarios: Schema.Array(Schema.String),
  bannerUncertainRuns: Count,
  triage: Schema.Struct({
    status: Schema.Literals(["open", "accepted_risk", "fixed"]),
    reason: Schema.NullOr(Schema.String),
  }),
  note: Schema.NullOr(Schema.String),
  evidence: Schema.NullOr(
    Schema.Struct({ caption: Schema.String, rows: Schema.Array(EvidenceRow) }),
  ),
})

const ChangeItem = Schema.Struct({
  ruleId: Schema.String,
  state: Schema.Literals(["new", "regressed", "fixed", "verdict_changed"]),
  severity: Severity,
  title: Schema.String,
  /** Pages the change is on and pages compared for the rule; counted, never named (aliases differ between audits). */
  pages: Count,
  pagesCompared: Count,
  /** Pages the change is on that the other audit did not check: counted apart from the compared ones. */
  pagesOutside: Count,
  confidence: Schema.Literals(["normal", "low"]),
  confirmation: Schema.Literals(["none", "repeated", "not_repeated", "incomplete"]),
  qualifier: Schema.NullOr(Schema.Literal("partly_unknown_before")),
})

const ChangeTag = Schema.Struct({
  change: Schema.Literals(["disappeared", "new", "destination_changed", "events_changed"]),
  vendor: Schema.String,
  destination: Schema.NullOr(Schema.String),
  eventsAdded: Schema.Array(Schema.String),
  eventsRemoved: Schema.Array(Schema.String),
  cellsAffected: Count,
  cellsCompared: Count,
})

/** What changed since the baseline audit, frozen with the snapshot; null when there is no baseline or the author switched it off. */
const Changes = Schema.Struct({
  baselineDate: Schema.String,
  counts: Schema.Struct({
    new: Count,
    regressed: Count,
    fixed: Count,
    unchanged: Count,
    verdictChanged: Count,
    notComparable: Count,
  }),
  /** Changed findings left out of the detail: counted, never named. */
  omitted: Count,
  score: Schema.Struct({
    before: Schema.NullOr(Count),
    now: Schema.NullOr(Count),
    delta: Schema.NullOr(Schema.Int),
  }),
  items: Schema.Array(ChangeItem),
  tags: Schema.Array(ChangeTag),
  notices: Schema.Array(
    Schema.Literals([
      "rules_changed",
      "scope_differs",
      "banner_differs",
      "consent_differs",
      "score_not_comparable",
    ]),
  ),
  lines: Schema.Array(Schema.String),
})

export const ReportModel = Schema.Struct({
  modelVersion: Schema.Literals([1, 2, 3, REPORT_MODEL_VERSION]),
  generatedAt: Schema.String,
  detail: Detail,
  branding: Schema.Struct({
    agencyName: Schema.String,
    accent: Schema.Literals(ACCENTS.map((accent) => accent.id)),
    footerText: Schema.NullOr(Schema.String),
    showPoweredBy: Schema.Boolean,
    logoDigest: Schema.NullOr(Schema.String),
  }),
  cover: Schema.Struct({
    clientName: Schema.String,
    siteName: Schema.String,
    host: Schema.String,
    auditedAt: Schema.String,
    scope: Schema.Struct({
      pages: Some(Schema.String),
      scenarios: Some(Schema.String),
      viewports: Some(Schema.String),
      journey: Schema.Boolean,
      clickIds: Schema.Boolean,
    }),
  }),
  summary: Schema.Struct({
    source: Schema.Literals(["generated", "author"]),
    text: Schema.NullOr(Schema.String),
    score: Score,
    withoutAccepted: Schema.NullOr(Count),
    runHealth: Schema.Struct({
      startFailed: Schema.Boolean,
      startPage: Schema.NullOr(Schema.String),
      startReason: Schema.NullOr(Schema.String),
      brokenPages: Schema.Array(
        Schema.Struct({ page: Schema.String, reason: Schema.NullOr(Schema.String) }),
      ),
      unfinishedRuns: Count,
      incomplete: Schema.Boolean,
    }),
    counts: Schema.Struct({
      critical: Count,
      warning: Count,
      info: Count,
      couldNotCheck: Count,
      acceptedRisk: Count,
      fixed: Count,
    }),
    scoreCoverage: Schema.Struct({ checks: Count, unresolvedChecks: Count }),
    /** The rules that could not be checked, by why: a page that did not load, no run at all, or some runs. */
    checkGaps: Schema.Struct({
      blockedRules: Count,
      neverChecked: Schema.Array(Schema.String),
      otherRules: Count,
      /** Null when a snapshot from model version 1 did not record the runs. */
      otherRuns: Schema.NullOr(Count),
    }),
    headlines: Some(Schema.String),
    coverage: Schema.Struct({
      evaluatedRuns: Count,
      totalRuns: Count,
      unresolvedRules: Count,
      /** Null in a snapshot from model version 1, which did not record it. */
      unresolvedRuns: Schema.NullOr(Count),
      bannerUncertainRuns: Count,
    }),
    worst: Schema.NullOr(
      Schema.Struct({
        ruleId: Schema.String,
        severity: Severity,
        title: Schema.String,
        scopeLine: Schema.String,
      }),
    ),
  }),
  method: Schema.Struct({
    rulesVersions: Some(Schema.String),
    scoreVersion: Count,
    runs: Schema.Struct({ complete: Count, partial: Count, failed: Count }),
    mixedVersions: Schema.Boolean,
  }),
  consent: Schema.Struct({
    scenarios: Schema.Array(Schema.String),
    rows: Schema.Array(ConsentRow),
  }),
  findings: Schema.Array(ReportFinding),
  changes: Schema.NullOr(Changes),
  leftOut: Schema.Array(Schema.Struct({ ruleId: Schema.String, title: Schema.String })),
  actionPlan: Schema.Array(
    Schema.Struct({
      owner: Schema.NullOr(OwnerId),
      items: Schema.Array(
        Schema.Struct({
          ruleId: Schema.String,
          severity: Severity,
          title: Schema.String,
          firstStep: Schema.String,
        }),
      ),
    }),
  ),
  appendix: Schema.Struct({
    couldNotCheck: Schema.Array(
      Schema.Struct({ ruleId: Schema.String, checkTitle: Schema.String, runs: Count }),
    ),
    notEvaluated: Schema.Array(
      Schema.Struct({
        page: Schema.String,
        scenario: Schema.String,
        viewport: Schema.String,
        reason: Schema.String,
      }),
    ),
    rules: Schema.Array(
      Schema.Struct({
        ruleId: Schema.String,
        title: Schema.String,
        area: Schema.String,
        severity: Severity,
        version: Schema.String,
        pass: Count,
        fail: Count,
        couldNotCheck: Count,
        notApplicable: Count,
      }),
    ),
  }),
})

export const decodeReportModel = Schema.decodeUnknownEffect(ReportModel)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** Each step turns the JSON stored at version `n` into version `n + 1`. */
const UPGRADES: Record<number, (json: unknown) => unknown> = {
  1: (json) => {
    if (!isRecord(json) || !isRecord(json.summary) || !isRecord(json.summary.coverage)) return json
    const { summary } = json
    const { coverage } = json.summary
    return {
      ...json,
      summary: {
        ...summary,
        coverage: { ...coverage, unresolvedRuns: coverage.unresolvedRuns ?? null },
      },
    }
  },
  2: (json) => {
    if (!isRecord(json) || !isRecord(json.summary) || !isRecord(json.summary.coverage)) return json
    const { summary } = json
    const { unresolvedRules, unresolvedRuns } = json.summary.coverage
    return {
      ...json,
      summary: {
        ...summary,
        checkGaps: {
          blockedRules: 0,
          neverChecked: [],
          otherRules: unresolvedRules,
          otherRuns: unresolvedRuns,
        },
      },
    }
  },
  3: (json) => (isRecord(json) ? { ...json, changes: null } : json),
}

export class UnknownModelVersion extends Data.TaggedError("UnknownModelVersion")<{
  version: number
}> {}

/** Decodes a stored snapshot with the rules of the version it was written under. */
export const decodeStoredReportModel = Effect.fn("decodeStoredReportModel")(function* (
  version: number,
  json: unknown,
) {
  if (!Number.isInteger(version) || version < 1 || version > REPORT_MODEL_VERSION)
    return yield* new UnknownModelVersion({ version })
  let upgraded = json
  for (let v = version; v < REPORT_MODEL_VERSION; v++) upgraded = UPGRADES[v]?.(upgraded)
  return yield* decodeReportModel(upgraded)
})

export type EvidenceRow = typeof EvidenceRow.Type
export type ReportModel = typeof ReportModel.Type
export type ReportFinding = typeof ReportFinding.Type
export type DisclosureLevel = ReportModel["detail"]

/** What only the consultant sees: never serialised into a snapshot, a share response or the CSV. */
export interface ConsultantPayload {
  edits: { summary: string | null; detail: DisclosureLevel; includeChanges: boolean }
  hiddenFindings: ReportFinding[]
  /** The changes since the baseline, each with whether the author left it out, for the switch and the dimmed list. Null with no baseline. */
  changeRows: {
    against: string
    items: ReadonlyArray<{
      ruleId: string
      title: string
      state: "new" | "regressed" | "fixed" | "verdict_changed"
      hidden: boolean
    }>
  } | null
  /** Notes printed in the report that were carried over from an earlier audit and not edited since. */
  carriedNotes: number
  /** What switching to Detailed would print beyond Standard: the entered page paths and Meta and TikTok IDs. */
  disclosure: { pages: ReadonlyArray<string>; destinations: ReadonlyArray<string> }
  changesSincePublished: boolean
}

/** Code unit order, the same in every runtime (unlike `localeCompare`), so hashes agree everywhere. */
export const byText = (a: string, b: string) => (a < b ? -1 : Number(a > b))

const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 } as const

/** Severity, then the share of runs failed (compared exactly, without division), then rule id. */
export const byFindingOrder = (
  a: {
    severity: keyof typeof SEVERITY_RANK
    failingRuns: number
    knownRuns: number
    ruleId: string
  },
  b: typeof a,
) =>
  SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
  b.failingRuns * a.knownRuns - a.failingRuns * b.knownRuns ||
  byText(a.ruleId, b.ruleId)

const OWNER_ORDER = ["consent-platform", "tag-manager", "developer", null] as const

/**
 * What to fix first, grouped by who usually fixes it (consent platform, tag manager, developer,
 * then not assigned): the open findings only, each with its first fix step, in the order the
 * findings come in.
 */
export function actionPlanOf(findings: ReadonlyArray<ReportFinding>): ReportModel["actionPlan"] {
  return OWNER_ORDER.flatMap((owner) => {
    const items = findings
      .filter((f) => f.triage.status === "open" && f.owner === owner)
      .map((f) => ({
        ruleId: f.ruleId,
        severity: f.severity,
        title: f.title,
        firstStep: f.fix[0] ?? f.title,
      }))
    return items.length === 0 ? [] : [{ owner, items }]
  })
}

const dayFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
})
const timeFormat = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
})

/**
 * "28 October 2026, 13:21 UTC": the same on the server, in the browser and in print. The report has
 * no reader's zone to use, so it says its own; the time lets a reader place it against their day.
 */
export const reportDate = (iso: string) => {
  const date = new Date(iso)
  return `${dayFormat.format(date)}, ${timeFormat.format(date)} UTC`
}

const SEVERITY_WORD = { critical: "Critical", warning: "Warning", info: "Info" } as const
const MAX_FINDING_HEADLINES = 4

interface HeadlineFinding {
  ruleId: string
  severity: keyof typeof SEVERITY_RANK
  title: string
  failingRuns: number
  knownRuns: number
  triage: { status: string }
}

/**
 * The summary's sentences, from stored finding titles and counts only: up to four about the open
 * failing findings the report details (the fourth becomes "and n more" when there are more), one
 * about findings the author left out of the detail, then one about coverage. Findings that could not
 * be checked are told apart in `checkGaps`, not here. The same findings give the same sentences.
 */
export function headlinesOf(
  failing: ReadonlyArray<HeadlineFinding>,
  coverage: {
    evaluatedRuns: number
    totalRuns: number
    unresolvedRules: number
    leftOut: number
    partial: boolean
    tooLittle: boolean
  },
): string[] {
  const open = failing.filter((f) => f.triage.status === "open").toSorted(byFindingOrder)
  const lines: string[] = []
  if (failing.length === 0 && coverage.leftOut === 0) {
    let none = "No failing checks in the pages and scenarios this audit ran."
    if (coverage.tooLittle) none = "Too little was captured to say whether anything fails."
    else if (coverage.partial) none = "No failing checks in the runs that were captured."
    lines.push(none)
  } else if (failing.length > 0 && open.length === 0) {
    const accepted = failing.filter((f) => f.triage.status === "accepted_risk").length
    const fixed = failing.filter((f) => f.triage.status === "fixed").length
    const parts = [
      accepted > 0 ? count(accepted, "accepted risk") : null,
      fixed > 0 ? `${fixed} marked fixed` : null,
    ].filter((part) => part !== null)
    lines.push(`No open failing findings: ${parts.join(", ")}.`)
  } else {
    const shown = open.length > MAX_FINDING_HEADLINES ? MAX_FINDING_HEADLINES - 1 : open.length
    for (const f of open.slice(0, shown))
      lines.push(
        `${SEVERITY_WORD[f.severity]}: ${f.title}, failed on ${f.failingRuns} of ${f.knownRuns} runs where it could be checked.`,
      )
    if (open.length > shown) lines.push(`And ${open.length - shown} more open failing findings.`)
  }
  if (coverage.leftOut > 0)
    lines.push(
      `${count(coverage.leftOut, "more finding")} ${coverage.leftOut === 1 ? "counts" : "count"} in the score but ${coverage.leftOut === 1 ? "is" : "are"} not detailed here.`,
    )
  if (coverage.evaluatedRuns < coverage.totalRuns)
    lines.push(
      `Partly evaluated: ${coverage.evaluatedRuns} of ${coverage.totalRuns} runs have check results.`,
    )
  else if (coverage.unresolvedRules === 0)
    lines.push(`All ${coverage.totalRuns} runs were evaluated and every check resolved.`)
  return lines
}
