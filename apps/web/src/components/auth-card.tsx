import type { ReactNode } from "react"
import { Brand, LogoMark } from "@/components/logo"

export function AuthCard({
  title,
  description,
  children,
  footer,
  account,
}: {
  title: string
  description: string
  children: ReactNode
  footer?: ReactNode
  account?: ReactNode
}) {
  return (
    <div className="flex min-h-svh flex-col">
      {account === undefined ? null : (
        <header className="flex flex-wrap items-center justify-between gap-4 p-6">
          <Brand />
          {account}
        </header>
      )}
      <main className="flex flex-1 items-center justify-center bg-linear-to-b from-accent/60 to-background px-4 py-12 sm:px-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-3">
            <LogoMark className="size-10" />
            <p className="text-lg font-semibold tracking-tight">
              See what your client&rsquo;s tags really do before consent.
            </p>
          </div>
          <div className="space-y-6 rounded-xl border bg-card p-6 shadow-xs ring-1 ring-foreground/5">
            <div className="space-y-2">
              <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
              <p className="text-sm text-muted-foreground">{description}</p>
            </div>
            {children}
            {footer === undefined ? null : (
              <p className="text-sm text-muted-foreground">{footer}</p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Open source (AGPL-3.0). Audits from the outside.
          </p>
        </div>
      </main>
    </div>
  )
}
