import { Schema } from "effect"
import { count } from "./format"
import { ACCENTS } from "./report-accent"

export const REPORT_MODEL_VERSION = 1

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
  versions: Schema.Array(Schema.String),
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

export const ReportModel = Schema.Struct({
  modelVersion: Schema.Literal(REPORT_MODEL_VERSION),
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
      pages: Schema.Array(Schema.String),
      scenarios: Schema.Array(Schema.String),
      viewports: Schema.Array(Schema.String),
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
    headlines: Schema.Array(Schema.String),
    coverage: Schema.Struct({
      evaluatedRuns: Count,
      totalRuns: Count,
      unresolvedRules: Count,
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
    rulesVersions: Schema.Array(Schema.String),
    scoreVersion: Count,
    runs: Schema.Struct({ complete: Count, partial: Count, failed: Count }),
    mixedVersions: Schema.Boolean,
  }),
  consent: Schema.Struct({
    scenarios: Schema.Array(Schema.String),
    rows: Schema.Array(ConsentRow),
  }),
  findings: Schema.Array(ReportFinding),
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

export type EvidenceRow = typeof EvidenceRow.Type
export type ReportModel = typeof ReportModel.Type
export type ReportFinding = typeof ReportFinding.Type
export type DisclosureLevel = ReportModel["detail"]

/** What only the consultant sees: never serialised into a snapshot, a share response or the CSV. */
export interface ConsultantPayload {
  edits: { summary: string | null; detail: DisclosureLevel }
  hiddenFindings: ReportFinding[]
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

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
})

/** "28 October 2026 (UTC)": the same on the server, in the browser and in print. */
export const reportDate = (iso: string) => `${dateFormat.format(new Date(iso))} (UTC)`

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
 * failing findings (the fourth becomes "and n more" when there are more), then one line about
 * coverage. The same findings give the same sentences.
 */
export function headlinesOf(
  failing: ReadonlyArray<HeadlineFinding>,
  coverage: {
    evaluatedRuns: number
    totalRuns: number
    unresolvedRules: number
    unresolvedRuns: number
  },
): string[] {
  const open = failing.filter((f) => f.triage.status === "open").toSorted(byFindingOrder)
  const lines: string[] = []
  if (failing.length === 0)
    lines.push("No failing checks in the pages and scenarios this audit ran.")
  else if (open.length === 0) {
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
  if (coverage.evaluatedRuns < coverage.totalRuns)
    lines.push(
      `Partly evaluated: ${coverage.evaluatedRuns} of ${coverage.totalRuns} runs have check results.`,
    )
  else if (coverage.unresolvedRules > 0)
    lines.push(
      `${count(coverage.unresolvedRules, "check")} could not be resolved on ${count(coverage.unresolvedRuns, "run")}; unresolved checks are never counted as passes.`,
    )
  else lines.push(`All ${coverage.totalRuns} runs were evaluated and every check resolved.`)
  return lines
}
