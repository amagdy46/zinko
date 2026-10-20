import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const TONE: Record<string, string> = {
  complete: "bg-success/10 text-success",
  partial: "bg-warning/15 text-warning",
  failed: "bg-destructive/10 text-destructive",
  running: "bg-primary/10 text-foreground",
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
