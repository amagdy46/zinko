import { CodeText } from "./code-text"
import type { ReportControls } from "./report-view"
import { SeverityBadge } from "@/components/severity"
import { StatusGlyph } from "@/components/status-glyph"
import { AREAS, BANNER_NOTE } from "@/lib/audit-labels"
import { count } from "@/lib/format"
import { whereOf } from "@/lib/report-projection"
import { cn } from "@/lib/utils"
import { ChevronDown } from "lucide-react"
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

const HEADS = ["Source", "Event", "Destination", "Timing", "Consent state"] as const

/** The evidence as a table from 640px up and in print, and as a definition list on a narrow screen. */
function Evidence({ evidence }: { evidence: NonNullable<ReportFinding["evidence"]> }) {
  const seen = new Map<string, number>()
  const rows = evidence.rows.map((row) => {
    const c = cells(row)
    const text = Object.values(c).join("|")
    seen.set(text, (seen.get(text) ?? 0) + 1)
    return { c, key: `${text}#${seen.get(text)}` }
  })
  const hasUnknown = rows.some(({ c }) => c.consent.includes("unknown"))
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{evidence.caption}</p>
      <div
        role="region"
        aria-label="Evidence, scrolls sideways on a narrow screen"
        tabIndex={0}
        className="scroll-edges hidden overflow-x-auto outline-none [--background:var(--card)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:block print:block print:overflow-visible"
      >
        <table className="w-full min-w-[30rem] border-collapse text-left text-xs leading-5 print:min-w-0">
          <thead>
            <tr className="border-b">
              {HEADS.map((head) => (
                <th key={head} scope="col" className="px-2 py-1 font-semibold">
                  {head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ c, key }) => (
              <tr key={key} className="border-b align-top">
                <td className="px-2 py-1">{c.source}</td>
                <td className="px-2 py-1 [overflow-wrap:normal]">{c.event}</td>
                <td className="px-2 py-1 [overflow-wrap:normal]">{c.destination}</td>
                <td className="px-2 py-1">{c.timing}</td>
                <td className="px-2 py-1">{c.consent}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasUnknown ? (
        <p className="text-xs text-muted-foreground">
          Unknown: the page sent no consent signal for that part, so Zinko cannot say what was
          allowed.
        </p>
      ) : null}
      <ul className="space-y-2 text-xs leading-5 sm:hidden print:hidden">
        {rows.map(({ c, key }) => (
          <li key={key} className="rounded-md border p-2">
            <dl className="grid grid-cols-[6.5rem_1fr] gap-x-2 gap-y-0.5">
              {HEADS.map((head, i) => {
                const value = [c.source, c.event, c.destination, c.timing, c.consent][i]
                return value === "" ? null : (
                  <div key={head} className="contents">
                    <dt className="text-muted-foreground">{head}</dt>
                    <dd>{value}</dd>
                  </div>
                )
              })}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Triage({ finding, agency }: { finding: ReportFinding; agency: string }) {
  const { triage } = finding
  if (triage.status === "open") return null
  if (triage.status === "fixed")
    return (
      <p className="flex items-start gap-2">
        <StatusGlyph meaning="finished" className="mt-0.5" />
        Marked fixed by {agency}; not yet confirmed by a re-check.
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

function WhyAndFix({ finding, withSteps }: { finding: ReportFinding; withSteps: boolean }) {
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <h4 className="font-semibold">Why it matters</h4>
        <p className="max-w-[65ch]">{finding.why}</p>
      </div>
      {withSteps ? <Steps steps={finding.fix} start={1} title="How to fix it" /> : null}
    </div>
  )
}

function Steps({
  steps,
  start,
  title,
}: {
  steps: ReadonlyArray<string>
  start: number
  title: string
}) {
  if (steps.length === 0) return null
  return (
    <div className="space-y-1">
      <h4 className="font-semibold">{title}</h4>
      <ol start={start} className="max-w-[65ch] list-decimal space-y-1 pl-5">
        {steps.map((step) => (
          <li key={step}>
            <CodeText text={step} />
          </li>
        ))}
      </ol>
    </div>
  )
}

/** Closed on screen; in print the same text is printed open, because a closed disclosure prints nothing. */
function TechnicalDetail({ finding, withSteps }: { finding: ReportFinding; withSteps: boolean }) {
  return (
    <>
      <details className="group rounded-md border print:hidden" data-testid="technical-detail">
        <summary className="flex min-h-8 cursor-pointer items-center rounded-md px-3 font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
          <ChevronDown
            aria-hidden="true"
            className="mr-2 size-4 -rotate-90 text-muted-foreground group-open:rotate-0"
          />
          Technical detail
        </summary>
        <div className="border-t px-3 py-2">
          <WhyAndFix finding={finding} withSteps={withSteps} />
        </div>
      </details>
      <div className="hidden print:block">
        <WhyAndFix finding={finding} withSteps={withSteps} />
      </div>
    </>
  )
}

function FindingCard({
  finding,
  agency,
  scenarioCount,
  hidden,
  actions,
}: {
  finding: ReportFinding
  agency: string
  scenarioCount: number
  hidden: boolean
  actions: ReactNode
}) {
  const [first, ...rest] = finding.fix
  const open = finding.triage.status === "open"
  return (
    <article
      id={`finding-${finding.ruleId}`}
      className={cn(
        "space-y-3 border-t pt-4 text-sm leading-6",
        hidden && "rounded-md border border-dashed bg-muted/40 p-4 print:hidden",
      )}
      aria-labelledby={`finding-title-${finding.ruleId}`}
    >
      <div className="keep-together space-y-1 print:break-after-avoid">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={finding.severity} />
          {hidden ? (
            <span className="rounded-md border px-2 py-0.5 text-xs" data-testid="left-out">
              Hidden from the detail
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
        {finding.clientVoice === null ? (
          <p className="text-muted-foreground">
            Failed on {finding.failingRuns} of {count(finding.knownRuns, "run")} where it could be
            checked, {whereOf(finding.pages, finding.scenarios, scenarioCount)}.
          </p>
        ) : null}
      </div>
      <Triage finding={finding} agency={agency} />
      {finding.clientVoice === null ? null : (
        <div className="space-y-2" data-testid="client-voice">
          <div className="space-y-1">
            <h4 className="font-semibold">What happened</h4>
            <p className="max-w-[65ch]">{finding.clientVoice.happened}</p>
          </div>
          <div className="space-y-1">
            <h4 className="font-semibold">What it means for you</h4>
            <p className="max-w-[65ch]">{finding.clientVoice.means}</p>
          </div>
        </div>
      )}
      {first === undefined || !open ? null : (
        <p className="rounded-md bg-muted/50 px-3 py-2" data-testid="fix-first">
          <span className="font-semibold tabular-nums">1. Fix first</span>
          <span className="text-muted-foreground">
            {" "}
            ({finding.owner === null ? "owner not assigned" : OWNER_LABELS[finding.owner]}):
          </span>{" "}
          <CodeText text={first} />
        </p>
      )}
      {open ? <Steps steps={rest} start={2} title="Next steps" /> : null}
      <TechnicalDetail finding={finding} withSteps={!open} />
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
      {finding.note === null ? null : (
        <div className="space-y-0.5 border-l-2 border-report-accent pl-3">
          <p className="text-xs font-semibold">Note from {agency}</p>
          <p className="max-w-[65ch] whitespace-pre-line [overflow-wrap:anywhere]">
            {finding.note}
          </p>
        </div>
      )}
      {hidden ? (
        <p className="text-muted-foreground">
          Hidden from the detail: the shared report does not show this card, its plan entry or its
          name in the summary. The score and counts still include it.
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
    <section
      id="findings"
      aria-label="Findings"
      className="space-y-4 px-4 sm:px-8 py-8 text-sm leading-6 print:break-before-page print:p-0 print:leading-snug"
    >
      <h2 className="text-xl font-semibold">Findings</h2>
      {controls === undefined ? null : (
        <p className="text-xs text-muted-foreground print:hidden">
          Hide detail, keep in score: the shared report does not show the card, its plan entry or
          its name in the summary. It still counts in the score.
        </p>
      )}
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
              agency={model.branding.agencyName}
              scenarioCount={model.cover.scope.scenarios.length}
              hidden={hidden}
              actions={Actions === undefined ? null : <Actions finding={finding} hidden={hidden} />}
            />
          )
        })
      )}
    </section>
  )
}
