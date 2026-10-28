import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/** The heading of a section inside a page: `text-base` semibold, with an optional line and trailing control. */
export function SectionHeading({
  as: Tag = "h2",
  title,
  description,
  actions,
  className,
}: {
  as?: "h2" | "h3"
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-x-4 gap-y-2", className)}>
      <div className="min-w-0 space-y-1">
        <Tag className="text-base font-semibold">{title}</Tag>
        {description && <p className="max-w-prose text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
