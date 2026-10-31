import { Link, type LinkProps } from "@tanstack/react-router"
import type { MouseEvent, ReactNode } from "react"
import { RelativeTime } from "@/components/relative-time"
import { StatusGlyph, type StatusMeaning } from "@/components/status-glyph"
import { cn } from "@/lib/utils"
import type { getAudit } from "@/server/audits"

export type Stage = NonNullable<Awaited<ReturnType<typeof getAudit>>["stage"]>

type Step = {
  name: string
  glyph: StatusMeaning
  done: boolean
  words: ReactNode
  /** Where the step goes: a link, the Re-run dialog's button, or plain text with its reason. */
  to: LinkProps | "rerun" | "text"
}

const ACTIVE = new Set(["queued", "running"])

const cell =
  "flex min-h-12 w-full min-w-0 flex-col justify-center gap-0.5 px-3 py-2 text-left text-sm outline-none"
const interactive =
  "hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"

const captureWords = (c: Stage["capture"]) => {
  if (c.active) {
    const finished = c.complete + c.partial + c.failed
    return {
      glyph: "running",
      done: false,
      text: `${finished} of ${c.total} runs finished`,
    } as const
  }
  if (c.complete === c.total)
    return { glyph: "pass", done: true, text: `${c.total} of ${c.total} runs captured` } as const
  const parts = [
    c.complete > 0 && `${c.complete} captured`,
    c.partial > 0 && `${c.partial} partial`,
    c.failed > 0 && `${c.failed} failed`,
  ].filter(Boolean)
  return {
    glyph: c.complete === 0 && c.partial === 0 ? "failed" : "partial",
    done: false,
    text: parts.join(", "),
  } as const
}

const decisionWords = (d: Stage["decisions"], gaps: boolean) => {
  if (!d.evaluated) return { glyph: "not-evaluated", done: false, text: "Not evaluated" } as const
  if (d.failing === 0)
    return {
      glyph: "pass",
      done: true,
      text: gaps ? "No failing findings in evaluated runs" : "No failing findings",
    } as const
  const carried = d.carriedOver > 0 ? ` (${d.carriedOver} carried over)` : ""
  const done = d.decided === d.failing
  return {
    glyph: done ? "pass" : "queued",
    done,
    text: `${d.decided} of ${d.failing} decided${carried}`,
  } as const
}

const reportWords = (r: Stage["report"]) => {
  if (r.published === null) return { glyph: "queued", done: false, text: "Draft" } as const
  if (r.shared === null)
    return { glyph: "queued", done: false, text: `Published v${r.published}` } as const
  return {
    glyph: "pass",
    done: true,
    text:
      r.shared === r.published
        ? `Shared v${r.shared}`
        : `Shared v${r.shared}, latest v${r.published}`,
  } as const
}

/**
 * Where a full audit is in the loop: capture, decisions, report, re-audit. A step is done by a
 * glyph and a word, never by colour; the first step that can be worked on says "Next". Every step
 * moves to where it is worked on. `onRerun` opens the Re-run dialog with the clicked button as the
 * element focus returns to.
 */
export function StageStrip({
  auditId,
  stage,
  active,
  archived,
  onRerun,
}: {
  auditId: string
  stage: Stage
  active: boolean
  archived: boolean
  onRerun: (event: MouseEvent<HTMLButtonElement>) => void
}) {
  const params = { auditId }
  const capture = captureWords(stage.capture)
  const decisions = decisionWords(stage.decisions, stage.capture.partial + stage.capture.failed > 0)
  const report = reportWords(stage.report)
  const successor = stage.reaudit

  let reaudit: Step
  if (successor === null) {
    let reason: string | null = null
    if (active) reason = "Re-run after this audit finishes"
    else if (archived) reason = "Re-run unavailable: site archived"
    reaudit = {
      name: "Re-audit",
      glyph: "queued",
      done: false,
      words: reason ?? "Re-run after fixes",
      to: reason === null ? "rerun" : "text",
    }
  } else {
    const settled = !ACTIVE.has(successor.status)
    let glyph: StatusMeaning = "running"
    let words: ReactNode = "Re-run in progress"
    if (settled && successor.evaluated) {
      glyph = "pass"
      words = (
        <>
          Re-run <RelativeTime date={successor.at} />
        </>
      )
    } else if (settled) {
      glyph = "not-evaluated"
      words = "Re-run not evaluated"
    }
    reaudit = {
      name: "Re-audit",
      glyph,
      done: settled && successor.evaluated,
      words,
      to:
        settled && successor.evaluated
          ? { to: "/app/audits/$auditId/compare", params: { auditId: successor.id } }
          : { to: "/app/audits/$auditId", params: { auditId: successor.id } },
    }
  }

  const steps: Step[] = [
    {
      name: "Capture",
      glyph: capture.glyph,
      done: capture.done,
      words: capture.text,
      to: { to: "/app/audits/$auditId", params, search: { view: "matrix" } },
    },
    {
      name: "Decisions",
      glyph: decisions.glyph,
      done: decisions.done,
      words: decisions.text,
      to: { to: "/app/audits/$auditId/findings", params },
    },
    {
      name: "Report",
      glyph: report.glyph,
      done: report.done,
      words: report.text,
      to: {
        to: "/app/audits/$auditId/report",
        params,
        ...(stage.report.shared === null ? {} : { search: { share: 1 } }),
      },
    },
    reaudit,
  ]
  // While the audit runs, capture is next. Once settled it keeps its counts but is never next:
  // the first step after it that can be worked on is.
  const { evaluated } = stage.decisions
  const available = [
    stage.capture.active,
    evaluated && !decisions.done,
    evaluated && stage.report.shared === null,
    reaudit.to === "rerun",
  ]
  const next = available.indexOf(true)

  return (
    <nav aria-label="Audit stages">
      <ol className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4">
        {steps.map((step, index) => (
          <li key={step.name} className="bg-card">
            <StepCell step={step} next={index === next} onRerun={onRerun} />
          </li>
        ))}
      </ol>
    </nav>
  )
}

function StepCell({
  step,
  next,
  onRerun,
}: {
  step: Step
  next: boolean
  onRerun: (event: MouseEvent<HTMLButtonElement>) => void
}) {
  const content = (
    <>
      <span className="type-label flex items-center gap-2">
        {step.name}
        {next ? (
          <span className="rounded-sm border border-foreground px-1 text-foreground">Next</span>
        ) : null}
      </span>
      <span className="flex items-start gap-1.5 text-foreground">
        <StatusGlyph meaning={step.glyph} className="mt-0.5" />
        <span className="min-w-0">
          {step.done ? <span className="sr-only">Done: </span> : null}
          {step.words}
        </span>
      </span>
    </>
  )
  if (step.to === "text") return <div className={cell}>{content}</div>
  if (step.to === "rerun")
    return (
      <button type="button" onClick={onRerun} className={cn(cell, interactive)}>
        {content}
      </button>
    )
  return (
    <Link {...step.to} className={cn(cell, interactive)}>
      {content}
    </Link>
  )
}
