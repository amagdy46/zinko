import { Link } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { ChangeBadge } from "@/components/change-badge"
import { SeverityOrUnchecked } from "@/components/compare/findings-table"
import { StatusGlyph } from "@/components/status-glyph"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { CellKey, Comparison, FindingChange } from "@/lib/compare"
import {
  cellPage,
  cellScenario,
  changeLine,
  triageLine,
  verdictMeaning,
  VERDICT_WORDS,
} from "@/lib/compare-text"
import { shortDate, useTimeZone } from "@/lib/format"

/** One change in detail: why it has its state, and the cell table (page, scenario, viewport, before, now). */
export function ChangeSheet({
  auditId,
  comparison,
  ruleId,
  onClose,
  opener,
}: {
  auditId: string
  comparison: Comparison
  ruleId: string | undefined
  onClose: () => void
  opener: { current: HTMLElement | null }
}) {
  const timeZone = useTimeZone()
  const [mobile, setMobile] = useState(false)
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)")
    const update = () => setMobile(media.matches)
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])
  const finding = comparison.findings.find((f) => f.ruleId === ruleId)
  const cells: ReadonlyArray<CellKey> = comparison.cells
  return (
    <Sheet
      open={ruleId !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent
        side={mobile ? "bottom" : "right"}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          const target = opener.current?.isConnected
            ? opener.current
            : document.querySelector<HTMLElement>(`[data-rule="${CSS.escape(ruleId ?? "")}"]`)
          target?.focus()
        }}
        className={mobile ? "max-h-[90dvh] overflow-y-auto" : "w-full overflow-y-auto sm:max-w-2xl"}
      >
        <SheetHeader className="pr-12">
          <SheetTitle className="[overflow-wrap:anywhere]">
            {finding?.title ?? "Change not found"}
          </SheetTitle>
          <SheetDescription>
            {finding === undefined
              ? "This finding is not part of this comparison."
              : `${finding.ruleId}, compared with the audit of ${shortDate(comparison.before.createdAt, timeZone)}`}
          </SheetDescription>
        </SheetHeader>
        {finding === undefined ? null : (
          <Detail
            auditId={auditId}
            finding={finding}
            cells={cells}
            triage={triageLine(finding, (iso) => shortDate(iso, timeZone))}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

function Detail({
  auditId,
  finding,
  cells,
  triage,
}: {
  auditId: string
  finding: FindingChange
  cells: ReadonlyArray<CellKey>
  triage: string | null
}) {
  const timeZone = useTimeZone()
  const earlier = finding.earlierFailure
  return (
    <div className="space-y-4 px-4 pb-6">
      <div className="flex flex-wrap items-center gap-2">
        <ChangeBadge state={finding.state} />
        <SeverityOrUnchecked finding={finding} />
      </div>
      <p className="text-sm">{changeLine(finding)}</p>
      {earlier === null ? null : (
        <p className="text-sm text-muted-foreground">
          It also failed in the audit of {shortDate(earlier.date, timeZone)}.
        </p>
      )}
      {triage === null ? null : <p className="text-sm text-muted-foreground">{triage}</p>}
      {finding.now === "fail" || finding.now === "could_not_check" ? (
        <Link
          to="/app/audits/$auditId/findings"
          params={{ auditId }}
          search={{ finding: finding.ruleId }}
          className="inline-flex h-8 items-center rounded-sm text-sm underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Open in Findings
        </Link>
      ) : null}
      <section className="space-y-2" aria-label="Runs">
        <h3 className="text-sm font-medium">
          Runs
          {finding.cellChangesTotal > finding.cellChanges.length
            ? ` (${finding.cellChanges.length} of ${finding.cellChangesTotal})`
            : ""}
        </h3>
        <div
          tabIndex={0}
          role="region"
          aria-label="Runs that changed"
          className="overflow-x-auto rounded-md border outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Page</TableHead>
                <TableHead>Scenario</TableHead>
                <TableHead>Viewport</TableHead>
                <TableHead>Before</TableHead>
                <TableHead>Now</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {finding.cellChanges.map((change) => {
                const cell = cells[change.cell]
                return cell === undefined ? null : (
                  <TableRow key={change.cell}>
                    <TableCell className="max-w-48 [overflow-wrap:anywhere]">
                      {cellPage(cell)}
                    </TableCell>
                    <TableCell>{cellScenario(cell)}</TableCell>
                    <TableCell className="capitalize">{cell.viewport}</TableCell>
                    <TableCell>
                      <Verdict value={change.before} />
                    </TableCell>
                    <TableCell>
                      <Verdict value={change.now} />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  )
}

function Verdict({ value }: { value: FindingChange["cellChanges"][number]["now"] }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <StatusGlyph meaning={verdictMeaning(value)} />
      {VERDICT_WORDS[value]}
    </span>
  )
}
