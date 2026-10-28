import { ChevronDown } from "lucide-react"
import { useEffect, useState } from "react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { count } from "@/lib/format"
import { cellPage, cellScenario } from "@/lib/compare-text"
import type { TagChange, TagChangeKind, TagDiff } from "@/lib/tag-diff"
import { vendorName } from "@/lib/tag-matrix"
import { cn } from "@/lib/utils"
import { getTagDiff } from "@/server/compare"

const KIND_WORDS: Record<TagChangeKind, string> = {
  disappeared: "Disappeared",
  destination_changed: "Destination changed",
  events_changed: "Events changed",
  new: "New",
}
const KINDS: ReadonlyArray<TagChangeKind> = [
  "disappeared",
  "destination_changed",
  "events_changed",
  "new",
]

const listed = (events: ReadonlyArray<string>) => events.join(", ")

const where = (c: TagChange) =>
  `${c.cellsAffected} of ${count(c.cellsCompared, "run")} where it was seen`
const nameOf = (c: TagChange) => `${vendorName(c.vendor)} ${c.destinationId}`

const LINES: Record<TagChangeKind, (c: TagChange) => string> = {
  disappeared: (c) => `${nameOf(c)} no longer fires on ${where(c)}.`,
  new: (c) => `${nameOf(c)} now fires on ${where(c)}.`,
  destination_changed: (c) =>
    `${vendorName(c.vendor)} sends to ${c.destinationId} instead of ${c.previousDestinationId} on ${where(c)}.`,
  events_changed: (c) => {
    const parts = [
      c.eventsRemoved.length > 0 && `${listed(c.eventsRemoved)} no longer sent`,
      c.eventsAdded.length > 0 && `${listed(c.eventsAdded)} now sent`,
    ]
    return `${nameOf(c)}: ${parts.filter((p) => p !== false).join("; ")} on ${where(c)}.`
  },
}

/** One change as a sentence: what changed, and on how many of the runs where the vendor was seen. */
const lineOf = (c: TagChange) => LINES[c.change](c)

type Result = { diff: TagDiff } | { failed: true }

/** The tag-level diff, fetched when the section opens (it scans every hit of both audits). */
export function TagsSection({ auditId, against }: { auditId: string; against: string }) {
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  useEffect(() => {
    if (!open) return undefined
    let current = true
    getTagDiff({ data: { auditId, against } }).then(
      (diff) => {
        if (current) setResult({ diff })
      },
      () => {
        if (current) setResult({ failed: true })
      },
    )
    return () => {
      current = false
    }
  }, [open, auditId, against])
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="space-y-2">
      <CollapsibleTrigger className="flex h-8 w-full items-center justify-between gap-2 rounded-md text-left text-base font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
        Tags
        <ChevronDown
          aria-hidden="true"
          className={cn("size-4 transition-transform", open && "rotate-180")}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4">
        {open && result === null ? (
          <p role="status" className="text-sm text-muted-foreground">
            Reading the tags of both audits...
          </p>
        ) : null}
        {result !== null && "failed" in result ? (
          <p role="alert" className="text-sm text-destructive">
            The tags could not be compared. Try again.
          </p>
        ) : null}
        {result !== null && "diff" in result ? <Diff diff={result.diff} /> : null}
      </CollapsibleContent>
    </Collapsible>
  )
}

function Diff({ diff }: { diff: TagDiff }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {count(diff.compared, "run")} compared: captured completely in both audits.
        {diff.unfinished > 0
          ? ` ${count(diff.unfinished, "run")} not compared, because a run did not finish and could be missing a tag.`
          : ""}
      </p>
      {diff.changes.length === 0 ? (
        <p role="status" className="text-sm">
          No tag changed on the {count(diff.compared, "compared run")}.
        </p>
      ) : (
        KINDS.map((kind) => {
          const group = diff.changes.filter((c) => c.change === kind)
          return group.length === 0 ? null : (
            <section key={kind} aria-label={KIND_WORDS[kind]} className="space-y-2">
              <h3 className="text-sm font-medium">
                {KIND_WORDS[kind]} <span className="text-muted-foreground">{group.length}</span>
              </h3>
              <ul className="rounded-md border border-b-0">
                {group.map((c) => (
                  <li
                    key={`${c.change}|${c.vendor}|${c.destinationId}|${listed(c.eventsAdded)}|${listed(c.eventsRemoved)}`}
                    className="border-b px-3 py-2 text-sm"
                  >
                    <p>{lineOf(c)}</p>
                    <details className="mt-1">
                      <summary className="inline-flex min-h-8 cursor-pointer items-center rounded-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
                        Show runs
                        {c.cellsAffected > c.cells.length
                          ? ` (${c.cells.length} of ${c.cellsAffected})`
                          : ""}
                      </summary>
                      <ul className="mt-1 space-y-0.5 text-muted-foreground">
                        {c.cells.map((index) => {
                          const cell = diff.cells[index]
                          return cell === undefined ? null : (
                            <li key={index} className="[overflow-wrap:anywhere]">
                              {cellPage(cell)} · {cellScenario(cell)} ·{" "}
                              <span className="capitalize">{cell.viewport}</span>
                            </li>
                          )
                        })}
                      </ul>
                    </details>
                  </li>
                ))}
              </ul>
            </section>
          )
        })
      )}
      {diff.omitted > 0 ? (
        <p className="text-sm text-muted-foreground">{diff.omitted} more changes are not listed.</p>
      ) : null}
    </div>
  )
}
