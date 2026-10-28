import { type ReactNode, useId } from "react"

/** A settings block: title and description on the left at lg, the controls on the right. */
export function SettingsSection({
  title,
  description,
  action,
  children,
}: {
  title: string
  description: ReactNode
  action?: ReactNode
  children: ReactNode
}) {
  const titleId = useId()
  return (
    <section
      aria-labelledby={titleId}
      className="grid gap-4 not-first-of-type:border-t not-first-of-type:pt-6 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-10"
    >
      <div className="min-w-0 space-y-1">
        <h2 id={titleId} className="text-base font-semibold wrap-break-word">
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">{description}</p>
        {action === undefined ? null : <div className="pt-2">{action}</div>}
      </div>
      <div className="min-w-0 space-y-4">{children}</div>
    </section>
  )
}
