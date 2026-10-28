import type { ReactNode } from "react"
import { SectionHeading } from "@/components/section-heading"

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
  return (
    <section className="grid gap-4 not-first-of-type:border-t not-first-of-type:pt-6 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-10">
      <div className="min-w-0 space-y-2">
        <SectionHeading title={title} description={description} />
        {action}
      </div>
      <div className="min-w-0 space-y-4">{children}</div>
    </section>
  )
}
