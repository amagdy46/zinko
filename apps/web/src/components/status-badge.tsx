import { StatusGlyph } from "@/components/status-glyph"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const statuses = {
  complete: { label: "Finished", meaning: "finished", tone: "bg-muted text-muted-foreground" },
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
  running: { label: "Running", meaning: "running", tone: "bg-primary/10 text-primary" },
  queued: { label: "Queued", meaning: "queued", tone: "bg-muted text-muted-foreground" },
  pending: { label: "Queued", meaning: "queued", tone: "bg-muted text-muted-foreground" },
  none: { label: "Not audited", meaning: "none", tone: "bg-muted text-muted-foreground" },
} as const

function isStatus(status: string): status is keyof typeof statuses {
  return Object.hasOwn(statuses, status)
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const display = isStatus(status)
    ? statuses[status]
    : { label: status, meaning: "none" as const, tone: "bg-muted text-muted-foreground" }
  return (
    <Badge variant="secondary" className={cn("gap-1.5", display.tone, className)}>
      <StatusGlyph meaning={display.meaning} />
      {display.label}
    </Badge>
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
    tone: "border-dashed border-input bg-muted text-muted-foreground",
  },
  pass: {
    label: "Pass",
    meaning: "pass",
    tone: "border-status-pass-border bg-status-pass-bg text-status-pass",
  },
  not_applicable: {
    label: "Not applicable",
    meaning: "not-applicable",
    tone: "bg-muted text-muted-foreground",
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
