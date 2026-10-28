import { Inbox, type LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

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
        "flex flex-col items-start gap-4 rounded-lg border bg-card p-6 sm:p-8",
        dashed && "border-dashed bg-transparent",
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"
      >
        <Icon className="size-5" />
      </span>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
      </div>
      {steps && (
        <div className="space-y-2">
          <h3 className="text-2xs font-medium tracking-wide text-muted-foreground uppercase">
            What happens next
          </h3>
          <ol className="space-y-1 text-sm">
            {steps.map((step, index) => (
              <li key={step} className="flex items-baseline gap-2">
                <span className="w-4 text-muted-foreground tabular-nums">{index + 1}.</span>
                {step}
              </li>
            ))}
          </ol>
        </div>
      )}
      {(action || secondary) && (
        <div className="flex flex-wrap items-center gap-2">
          {action}
          {secondary}
        </div>
      )}
    </div>
  )
}
