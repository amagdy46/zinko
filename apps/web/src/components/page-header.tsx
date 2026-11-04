import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export function PageHeader({
  title,
  answer = false,
  description,
  meta,
  actions,
}: {
  title: string
  /** The title is the result of the page, so it is set large. */
  answer?: boolean
  description?: ReactNode
  meta?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 space-y-1">
          <h1
            className={cn(
              "font-semibold tracking-tight wrap-break-word",
              answer ? "text-3xl sm:text-5xl" : "text-xl sm:text-2xl",
            )}
          >
            {title}
          </h1>
          {description && (
            <div className="max-w-prose text-sm text-muted-foreground">{description}</div>
          )}
          {meta && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {meta}
            </div>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  )
}
