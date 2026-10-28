import { Link } from "@tanstack/react-router"
import { useEffect, useRef, useState } from "react"
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react"
import { RunPath } from "@/components/evidence"
import { type AuditRun, RunImage, RunStatusBadge } from "@/components/run-matrix"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { runReason, runDuration, scenarioLabel } from "@/lib/audit-labels"
import { duration } from "@/lib/format"

type Finding = { ruleId: string; title: string; runIds: string[] }
const consentLabels = {
  accepted: "Accepted",
  rejected: "Rejected",
  none: "No interaction",
  "not-found": "Banner not found",
  "not-applied": "Choice not applied",
}

export function RunSheet({
  auditId,
  runs,
  selected,
  findings,
  onSelect,
}: {
  auditId: string
  runs: AuditRun[]
  selected?: string
  findings: Finding[]
  onSelect: (id?: string) => void
}) {
  const [mobile, setMobile] = useState(false)
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)")
    const update = () => setMobile(media.matches)
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])
  const opener = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (selected !== undefined) return undefined
    const remember = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement) opener.current = event.target
    }
    document.addEventListener("focusin", remember)
    return () => document.removeEventListener("focusin", remember)
  }, [selected])
  const index = runs.findIndex((run) => run.id === selected)
  const run = runs[index]
  const move = (offset: number) => {
    const next = runs[index + offset]
    if (next) onSelect(next.id)
  }
  return (
    <Sheet
      open={selected !== undefined}
      onOpenChange={(open) => {
        if (!open) onSelect()
      }}
    >
      <SheetContent
        side={mobile ? "bottom" : "right"}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          const target = opener.current?.isConnected
            ? opener.current
            : document.getElementById("runs-view")
          target?.focus()
        }}
        className={mobile ? "max-h-[90dvh] overflow-y-auto" : "w-full overflow-y-auto sm:max-w-xl"}
        onKeyDown={(event) => {
          if (
            event.target instanceof HTMLElement &&
            event.target.closest("input, textarea, select, [role=combobox]")
          )
            return
          if (event.key === "ArrowLeft") {
            event.preventDefault()
            move(-1)
          }
          if (event.key === "ArrowRight") {
            event.preventDefault()
            move(1)
          }
        }}
      >
        <SheetHeader className="pr-12">
          <SheetTitle className="break-all">
            {run ? <RunPath run={run} /> : "Run not found"}
          </SheetTitle>
          <SheetDescription>
            {run ? `Run ${index + 1} of ${runs.length}` : "This run does not belong to this audit."}
          </SheetDescription>
        </SheetHeader>
        {run ? (
          <div className="space-y-4 px-4 pb-6">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={index === 0} onClick={() => move(-1)}>
                <ChevronLeft />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={index === runs.length - 1}
                onClick={() => move(1)}
              >
                Next
                <ChevronRight />
              </Button>
              <RunStatusBadge status={run.status} />
            </div>
            <RunImage run={run} />
            <dl className="grid grid-cols-2 gap-3 text-sm">
              {[
                ["Scenario", scenarioLabel(run.scenario)],
                ["Viewport", run.viewport],
                [
                  "Consent",
                  run.consentOutcome === null ? "Not captured" : consentLabels[run.consentOutcome],
                ],
                ["Duration", runDuration(run) === null ? "—" : duration(runDuration(run) ?? 0)],
                ["Hits", run.hitCount],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            {runReason(run) ? (
              <p className="rounded-md border p-3 text-sm">{runReason(run)}</p>
            ) : null}
            {run.errors.length > 0 ? (
              <Collapsible>
                <CollapsibleTrigger className="group flex min-h-8 items-center gap-1.5 rounded-md text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
                  Technical details
                  <ChevronDown
                    aria-hidden="true"
                    className="size-4 transition-transform group-data-[state=open]:rotate-180"
                  />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ul className="space-y-2 text-sm">
                    {run.errors.map((error) => (
                      <li key={`${error.code}-${error.message}`} className="break-words">
                        <span className="font-medium">{error.code}: </span>
                        {error.message}
                      </li>
                    ))}
                  </ul>
                </CollapsibleContent>
              </Collapsible>
            ) : null}
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Same page and viewport</h3>
              <div className="flex flex-wrap gap-2">
                {runs
                  .filter(
                    (other) =>
                      other.pageUrl === run.pageUrl &&
                      other.journey === run.journey &&
                      other.viewport === run.viewport,
                  )
                  .map((other) => (
                    <Button
                      key={other.id}
                      size="sm"
                      variant={other.id === run.id ? "secondary" : "outline"}
                      aria-pressed={other.id === run.id}
                      onClick={() => onSelect(other.id)}
                    >
                      {scenarioLabel(other.scenario)}
                    </Button>
                  ))}
              </div>
            </div>
            <Button asChild variant="outline">
              <Link to="/app/audits/$auditId/hits" params={{ auditId }} search={{ runId: run.id }}>
                Open in Hits
              </Link>
            </Button>
            {runReason(run) === null ? (
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Failing findings for this run</h3>
                {findings
                  .filter((finding) => finding.runIds.includes(run.id))
                  .map((finding) => (
                    <Link
                      key={finding.ruleId}
                      to="/app/audits/$auditId/findings"
                      params={{ auditId }}
                      search={{ finding: finding.ruleId }}
                      className="block py-1.5 text-sm underline underline-offset-4"
                    >
                      {finding.title}
                    </Link>
                  ))}
                {findings.some((finding) => finding.runIds.includes(run.id)) ? null : (
                  <p className="text-xs text-muted-foreground">
                    No failing findings recorded for this run.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Could not check: this run did not finish.
              </p>
            )}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
