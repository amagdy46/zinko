import type { ReactNode } from "react"

export function PageHeader({
  title,
  description,
  meta,
  actions,
}: {
  title: string
  description?: ReactNode
  meta?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 space-y-1">
          <h1 className="text-xl font-semibold tracking-tight wrap-break-word sm:text-2xl">
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
