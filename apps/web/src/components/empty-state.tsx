import { Inbox, type LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/** A narrow, centred block: a task-specific icon, two lines and the action. It never spans the page. */
export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  steps,
  action,
  secondary,
  dashed = false,
}: {
  title: string
  description: string
  /** Say what is missing (Globe for sites, Users for clients), not "empty". */
  icon?: LucideIcon
  /** A short numbered "What happens next", for the first run of a list. */
  steps?: ReadonlyArray<string>
  action?: ReactNode
  secondary?: ReactNode
  /** Only for a result that was not evaluated: the dashed edge says "nothing was measured here". */
  dashed?: boolean
}) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-md flex-col items-center gap-4 px-4 py-12 text-center",
        dashed && "rounded-lg border border-dashed py-10",
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"
      >
        <Icon className="size-5" />
      </span>
      <div className="space-y-1">
        <h2 className="type-section">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {steps && (
        <div className="w-full space-y-2 rounded-lg border border-border-subtle bg-card p-4 text-left shadow-xs">
          <h3 className="type-label">What happens next</h3>
          <ol className="space-y-1.5 text-sm">
            {steps.map((step, index) => (
              <li key={step} className="flex items-baseline gap-2">
                <span className="w-4 shrink-0 text-muted-foreground tabular-nums">
                  {index + 1}.
                </span>
                {step}
              </li>
            ))}
          </ol>
        </div>
      )}
      {(action || secondary) && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondary}
        </div>
      )}
    </div>
  )
}
