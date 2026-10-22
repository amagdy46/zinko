import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const TONE: Record<string, string> = {
  complete: "bg-status-pass-bg text-status-pass",
  partial: "bg-sev-warning-bg text-sev-warning",
  failed: "bg-sev-critical-bg text-sev-critical",
  running: "bg-primary/10 text-primary",
}

/** A run or audit status: complete, partial, failed, running, queued or pending. */
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        "gap-1.5 capitalize",
        TONE[status] ?? "bg-muted text-muted-foreground",
        className,
      )}
    >
      <span
        className={cn("size-1.5 rounded-full bg-current", status === "running" && "animate-pulse")}
      />
      {status}
    </Badge>
  )
}
