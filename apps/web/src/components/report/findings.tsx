import type { ReportControls } from "./report-view"
import { SeverityBadge } from "@/components/severity"
import { StatusGlyph } from "@/components/status-glyph"
import { AREAS, BANNER_NOTE } from "@/lib/audit-labels"
import { count } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { ReactNode } from "react"
import {
  byFindingOrder,
  type EvidenceRow,
  OWNER_LABELS,
  type ReportFinding,
  type ReportModel,
} from "@/lib/report-model"

const TIMING = {
  "before-choice": "Before the choice",
  "after-choice": "After the choice",
  "no-choice": "No choice made",
} as const

const CATEGORY = {
  "consent-ping": "Consent ping",
  collection: "Collection request",
  other: "Other request",
} as const

const state = (adStorage: string | null, analyticsStorage: string | null) =>
  adStorage === null && analyticsStorage === null
    ? "No consent signal"
    : `Ads ${adStorage ?? "unknown"} · Analytics ${analyticsStorage ?? "unknown"}`

const BLANK = { source: "", event: "", destination: "", timing: "", consent: "" }

/** One evidence row as the table's five columns: what, event, destination, timing, consent state. */
function cells(row: EvidenceRow) {
  const timing = row.timing === null ? "" : TIMING[row.timing]
  switch (row.kind) {
    case "hit":
      return {
        source: row.vendor ?? "",
        event: row.event ?? "",
        destination: row.destination ?? (row.vendor === null ? "" : `${row.vendor} pixel`),
        timing,
        consent: state(row.adStorage, row.analyticsStorage),
      }
    case "request":
      return {
        source: row.category === null ? "Request" : CATEGORY[row.category],
        event:
          row.status === null
            ? ""
            : `Status ${row.status}${row.blocked === true ? ", blocked" : ""}`,
        destination: "",
        timing,
        consent: state(row.adStorage, row.analyticsStorage),
      }
    case "cookie":
      return { ...BLANK, source: "Cookie", event: row.cookie ?? "" }
    case "push":
      return { ...BLANK, source: "dataLayer push", event: row.command ?? "" }
    default:
      return { ...BLANK, source: "Page load", event: count(row.redirects ?? 0, "redirect") }
  }
}

function Evidence({ evidence }: { evidence: NonNullable<ReportFinding["evidence"]> }) {
  const seen = new Map<string, number>()
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{evidence.caption}</p>
      <div className="overflow-x-auto print:overflow-visible">
        <table className="w-full min-w-[30rem] border-collapse text-left text-xs">
          <thead>
            <tr className="border-b">
              {["Source", "Event", "Destination", "Timing", "Consent state"].map((head) => (
                <th key={head} scope="col" className="px-2 py-1 font-medium">
                  {head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {evidence.rows.map((row) => {
              const c = cells(row)
              const text = Object.values(c).join("|")
              seen.set(text, (seen.get(text) ?? 0) + 1)
              return (
                <tr key={`${text}#${seen.get(text)}`} className="border-b align-top">
                  <td className="px-2 py-1">{c.source}</td>
                  <td className="px-2 py-1 [overflow-wrap:anywhere]">{c.event}</td>
                  <td className="px-2 py-1 [overflow-wrap:anywhere]">{c.destination}</td>
                  <td className="px-2 py-1">{c.timing}</td>
                  <td className="px-2 py-1">{c.consent}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Triage({ finding }: { finding: ReportFinding }) {
  const { triage } = finding
  if (triage.status === "open") return null
  if (triage.status === "fixed")
    return (
      <p className="flex items-start gap-2">
        <StatusGlyph meaning="finished" className="mt-0.5" />
        Fixed: marked fixed by the author, not re-verified.
      </p>
    )
  return (
    <p className="flex items-start gap-2">
      <StatusGlyph meaning="none" className="mt-0.5" />
      <span>
        Accepted risk
        {triage.reason === null ? "" : `: ${triage.reason}`}
      </span>
    </p>
  )
}

function FindingCard({
  finding,
  hidden,
  actions,
}: {
  finding: ReportFinding
  hidden: boolean
  actions: ReactNode
}) {
  const scenarios = finding.scenarios.join(", ")
  return (
    <article
      id={`finding-${finding.ruleId}`}
      className={cn(
        "space-y-3 rounded-md border p-4 text-sm",
        hidden && "border-dashed bg-muted/40",
      )}
      aria-labelledby={`finding-title-${finding.ruleId}`}
    >
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={finding.severity} />
          {hidden ? (
            <span className="rounded-md border px-2 py-0.5 text-xs" data-testid="left-out">
              Left out
            </span>
          ) : null}
          <span className="text-xs text-muted-foreground">
            {AREAS[finding.area] ?? finding.area}
          </span>
        </div>
        <h3
          id={`finding-title-${finding.ruleId}`}
          className="text-base font-semibold [overflow-wrap:anywhere]"
        >
          {finding.title}
        </h3>
        <p className="text-muted-foreground">
          Failed on {finding.failingRuns} of {finding.knownRuns} runs where it could be checked,
          across {count(finding.pages.length, "page")}
          {scenarios === "" ? "" : ` (${scenarios})`}.
        </p>
      </div>
      <Triage finding={finding} />
      <div className="space-y-1">
        <h4 className="font-medium">Why it matters</h4>
        <p>{finding.why}</p>
      </div>
      <div className="space-y-1">
        <h4 className="font-medium">How to fix it</h4>
        <ol className="list-decimal space-y-1 pl-5">
          {finding.fix.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>
      {finding.evidence === null ? (
        <p className="text-muted-foreground">
          Evidence is not available for this finding in the stored captures.
        </p>
      ) : (
        <Evidence evidence={finding.evidence} />
      )}
      {finding.bannerUncertainRuns > 0 ? (
        <p className="rounded-md border border-dashed p-2 text-muted-foreground">
          {count(finding.bannerUncertainRuns, "failing run")} rest on an undetected banner.{" "}
          {BANNER_NOTE.summary}
        </p>
      ) : null}
      <p className="text-muted-foreground">
        Owner: {finding.owner === null ? "Owner not assigned" : OWNER_LABELS[finding.owner]}
      </p>
      {finding.note === null ? null : (
        <p className="border-l-2 pl-3 whitespace-pre-line [overflow-wrap:anywhere]">
          {finding.note}
        </p>
      )}
      {hidden ? (
        <p className="text-muted-foreground">
          Left out of the detail: the client does not see this card or its plan entry. The score and
          counts still include it.
        </p>
      ) : null}
      {actions}
    </article>
  )
}

/** The failing findings by severity, in the stored wording. */
export function Findings({ model, controls }: { model: ReportModel; controls?: ReportControls }) {
  const Actions = controls?.Finding
  const hiddenIds = new Set(controls?.hiddenFindings.map((f) => f.ruleId))
  const shown = [...model.findings, ...(controls?.hiddenFindings ?? [])].toSorted(byFindingOrder)
  return (
    <section id="findings" aria-label="Findings" className="space-y-4 px-8 py-8 text-sm">
      <h2 className="text-xl font-semibold">Findings</h2>
      {shown.length === 0 ? (
        <p className="flex items-start gap-2" data-testid="no-findings">
          <StatusGlyph meaning="pass" className="mt-0.5" />
          No failing checks in the pages and scenarios this audit ran.
        </p>
      ) : (
        shown.map((finding) => {
          const hidden = hiddenIds.has(finding.ruleId)
          return (
            <FindingCard
              key={finding.ruleId}
              finding={finding}
              hidden={hidden}
              actions={Actions === undefined ? null : <Actions finding={finding} hidden={hidden} />}
            />
          )
        })
      )}
    </section>
  )
}
