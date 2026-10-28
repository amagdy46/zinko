import { Link } from "@tanstack/react-router"
import { GitCompareArrows } from "lucide-react"
import { StatusGlyph } from "@/components/status-glyph"
import { recheckVerdict } from "@/lib/compare-text"
import { count, shortDate, useTimeZone } from "@/lib/format"

/** "What changed" at the top of a re-run's Overview: a few lines, then the whole Compare tab. */
export function Briefing({
  auditId,
  since,
  lines,
}: {
  auditId: string
  since: string
  lines: ReadonlyArray<string>
}) {
  const timeZone = useTimeZone()
  return (
    <section aria-labelledby="briefing-heading" className="space-y-2 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h2 id="briefing-heading" className="flex items-center gap-2 text-base font-semibold">
          <GitCompareArrows aria-hidden="true" className="size-4 text-muted-foreground" />
          Since the audit of {shortDate(since, timeZone)}
        </h2>
        <Link
          to="/app/audits/$auditId/compare"
          params={{ auditId }}
          className="inline-flex h-8 items-center rounded-sm text-sm underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          See all changes
        </Link>
      </div>
      <ul className="list-disc space-y-1 pl-4 text-sm">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  )
}

const VERDICT_GLYPH = { fixed: "pass", "still-fails": "fail", incomplete: "partial" } as const

/** The result of a re-check, which leads its Overview: a run that gave no verdict is never counted as a pass. */
export function RecheckResult({
  ruleId,
  title,
  failingRuns,
  determinateRuns,
  runs,
}: {
  ruleId: string
  title: string | null
  failingRuns: number
  determinateRuns: number
  runs: number
}) {
  const verdict = recheckVerdict({ failingRuns, determinateRuns, runs })
  return (
    <section
      aria-labelledby="recheck-heading"
      className="space-y-2 rounded-lg border bg-card p-5"
      data-testid="recheck-result"
    >
      <h2 id="recheck-heading" className="text-base font-semibold">
        Re-check of {title ?? ruleId}
      </h2>
      <p className="flex items-center gap-2 text-lg font-semibold">
        <StatusGlyph meaning={VERDICT_GLYPH[verdict.state]} />
        {verdict.text}
      </p>
      <p className="text-sm text-muted-foreground">
        A re-check covers {count(runs, "run")} for one check, so it has no score and does not
        replace an audit of the site.
      </p>
    </section>
  )
}
