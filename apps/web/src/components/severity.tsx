import { StatusGlyph } from "@/components/status-glyph"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const severities = {
  critical: {
    label: "Critical",
    badge: "border-sev-critical-border bg-sev-critical-bg text-sev-critical",
  },
  warning: {
    label: "Warning",
    badge: "border-sev-warning-border bg-sev-warning-bg text-sev-warning",
  },
  info: {
    label: "Info",
    badge: "border-sev-info-border bg-sev-info-bg text-sev-info",
  },
} as const

type Severity = keyof typeof severities

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  return (
    <Badge variant="secondary" className={cn("gap-1.5", severities[severity].badge, className)}>
      <StatusGlyph meaning={severity} />
      {severities[severity].label}
    </Badge>
  )
}

/** Classes for a finding row's 2px severity rule, without a background tint. */
export const SeverityMark = {
  critical: "border-l-2 border-l-sev-critical-solid",
  warning: "border-l-2 border-l-sev-warning-solid",
  info: "border-l-2 border-l-sev-info-solid",
} as const
