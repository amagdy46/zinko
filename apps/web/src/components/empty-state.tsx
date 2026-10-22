import type { ReactNode } from "react"

export function EmptyState({
  title,
  description,
  action,
  secondary,
}: {
  title: string
  description: string
  action?: ReactNode
  secondary?: ReactNode
}) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-6 sm:p-8">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
      </div>
      {(action || secondary) && (
        <div className="flex flex-wrap items-center gap-2">
          {action}
          {secondary}
        </div>
      )}
    </div>
  )
}
