import type { AuditStatus, RunStatus } from "@repo/core"
import { StatusGlyph, type StatusMeaning } from "@/components/status-glyph"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const neutral = "border-status-neutral-border bg-status-neutral-bg text-status-neutral"

const statuses = {
  complete: { label: "Finished", meaning: "finished", tone: neutral },
  partial: {
    label: "Partial",
    meaning: "partial",
    tone: "border-sev-warning-border bg-sev-warning-bg text-sev-warning",
  },
  failed: {
    label: "Failed",
    meaning: "failed",
    tone: "border-sev-critical-border bg-sev-critical-bg text-sev-critical",
  },
  running: {
    label: "Running",
    meaning: "running",
    tone: "border-status-active-border bg-status-active-bg text-status-active",
  },
  queued: { label: "Queued", meaning: "queued", tone: neutral },
  pending: { label: "Queued", meaning: "queued", tone: neutral },
  none: { label: "Not audited", meaning: "none", tone: neutral },
  unknown: { label: "Unknown", meaning: "none", tone: neutral },
} satisfies Record<
  AuditStatus | RunStatus | "none" | "unknown",
  { label: string; meaning: StatusMeaning; tone: string }
>

export type BadgeStatus = keyof typeof statuses

/** Narrows a stored status string at the boundary; a value the app does not know becomes "unknown". */
const isBadgeStatus = (status: string): status is BadgeStatus => Object.hasOwn(statuses, status)

export const toBadgeStatus = (status: string): BadgeStatus =>
  isBadgeStatus(status) ? status : "unknown"

export function StatusBadge({ status, className }: { status: BadgeStatus; className?: string }) {
  const display = statuses[status]
  return (
    <Badge variant="secondary" className={cn("gap-1.5", display.tone, className)}>
      <StatusGlyph meaning={display.meaning} />
      {display.label}
    </Badge>
  )
}

/** The glyph of a status with its word for a screen reader, where there is no room for the badge. */
export function StatusMark({ status, className }: { status: BadgeStatus; className?: string }) {
  const display = statuses[status]
  return (
    <span className={cn("inline-flex items-center", className)}>
      <StatusGlyph meaning={display.meaning} />
      <span className="sr-only">{display.label}</span>
    </span>
  )
}

const checks = {
  fail: {
    label: "Fail",
    meaning: "fail",
    tone: "border-sev-critical-border bg-sev-critical-bg text-sev-critical",
  },
  inconclusive: {
    label: "Could not check",
    meaning: "could-not-check",
    tone: "border-dashed border-status-neutral-border bg-status-neutral-bg text-status-neutral",
  },
  pass: {
    label: "Pass",
    meaning: "pass",
    tone: "border-status-pass-border bg-status-pass-bg text-status-pass",
  },
  not_applicable: {
    label: "Not applicable",
    meaning: "not-applicable",
    tone: neutral,
  },
} as const

export function CheckStatusBadge({
  status,
  className,
}: {
  status: keyof typeof checks
  className?: string
}) {
  const display = checks[status]
  return (
    <Badge variant="secondary" className={cn("gap-1.5", display.tone, className)}>
      <StatusGlyph meaning={display.meaning} />
      {display.label}
    </Badge>
  )
}
