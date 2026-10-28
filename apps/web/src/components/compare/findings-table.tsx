import { ChevronDown } from "lucide-react"
import { useState } from "react"
import { ChangeBadge, ChangeGlyph } from "@/components/change-badge"
import { SeverityBadge } from "@/components/severity"
import { CheckStatusBadge } from "@/components/status-badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import type { ChangeState, FindingChange } from "@/lib/compare"
import { changeLine, CHANGE_ORDER, CHANGE_WORDS, triageLine } from "@/lib/compare-text"
import { shortDate, useTimeZone } from "@/lib/format"
import { cn } from "@/lib/utils"

/** A finding that failed on neither side only could not be checked: it has no severity to show. */
export function SeverityOrUnchecked({ finding }: { finding: FindingChange }) {
  return finding.was === "fail" || finding.now === "fail" ? (
    <SeverityBadge severity={finding.severity} />
  ) : (
    <CheckStatusBadge status="inconclusive" />
  )
}

function ChangeRow({
  finding,
  onOpen,
}: {
  finding: FindingChange
  onOpen: (ruleId: string, opener: HTMLElement) => void
}) {
  const timeZone = useTimeZone()
  const triage = triageLine(finding, (iso) => shortDate(iso, timeZone))
  return (
    <li>
      <button
        type="button"
        onClick={(event) => onOpen(finding.ruleId, event.currentTarget)}
        data-rule={finding.ruleId}
        className="flex min-h-12 w-full flex-col gap-1 border-b px-3 py-2 text-left outline-none hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
      >
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <ChangeBadge state={finding.state} />
          <SeverityOrUnchecked finding={finding} />
          <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{finding.title}</span>
        </span>
        <span className="text-sm text-muted-foreground">{changeLine(finding)}</span>
        {triage === null ? null : <span className="text-sm text-muted-foreground">{triage}</span>}
      </button>
    </li>
  )
}

function Group({
  state,
  findings,
  filtered,
  onOpen,
}: {
  state: ChangeState
  findings: FindingChange[]
  filtered: boolean
  onOpen: (ruleId: string, opener: HTMLElement) => void
}) {
  const heading = (
    <span className="flex items-center gap-2">
      <ChangeGlyph state={state} />
      {CHANGE_WORDS[state]}
      <span className="text-sm font-normal text-muted-foreground tabular-nums">
        {findings.length}
      </span>
    </span>
  )
  const list = (
    <ul className="rounded-md border border-b-0">
      {findings.map((f) => (
        <ChangeRow key={f.ruleId} finding={f} onOpen={onOpen} />
      ))}
    </ul>
  )
  if (state !== "not_comparable") {
    return (
      <section aria-label={CHANGE_WORDS[state]} className="space-y-2">
        <h2 className="text-base font-semibold">{heading}</h2>
        {list}
      </section>
    )
  }
  return (
    <NotComparableGroup key={String(filtered)} heading={heading} filtered={filtered}>
      {list}
    </NotComparableGroup>
  )
}

function NotComparableGroup({
  heading,
  children,
  filtered,
}: {
  heading: React.ReactNode
  children: React.ReactNode
  filtered: boolean
}) {
  const [open, setOpen] = useState(filtered)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="space-y-2">
      <CollapsibleTrigger className="flex h-8 w-full items-center justify-between gap-2 rounded-md text-left text-base font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        {heading}
        <ChevronDown
          aria-hidden="true"
          className={cn("size-4 transition-transform", open && "rotate-180")}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  )
}

/** Findings grouped by state in the order a reader should weigh them; Not comparable is collapsed. */
export function FindingsTable({
  findings,
  state,
  onOpen,
}: {
  findings: FindingChange[]
  state: ChangeState | undefined
  onOpen: (ruleId: string, opener: HTMLElement) => void
}) {
  return (
    <div className="space-y-6">
      {CHANGE_ORDER.filter((s) => state === undefined || s === state).map((s) => {
        const group = findings.filter((f) => f.state === s)
        return group.length === 0 ? null : (
          <Group
            key={s}
            state={s}
            findings={group}
            filtered={state !== undefined}
            onOpen={onOpen}
          />
        )
      })}
    </div>
  )
}
