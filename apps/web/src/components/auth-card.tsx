import type { ReactNode } from "react"
import { Brand, LogoMark } from "@/components/logo"
import { BandBar } from "@/components/score-figure"
import { StatusGlyph } from "@/components/status-glyph"

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
      <main className="grid flex-1 lg:grid-cols-2">
        <aside
          aria-hidden="true"
          className="hidden flex-col justify-between gap-12 border-r bg-sidebar p-12 lg:flex"
        >
          <Brand className="text-lg" />
          <div className="max-w-md space-y-8">
            <p className="text-2xl font-semibold tracking-tight text-balance">{TAGLINE}</p>
            <SampleAudit />
          </div>
          <p className="text-xs text-muted-foreground">{LICENCE_LINE}</p>
        </aside>
        <div className="flex items-center justify-center bg-linear-to-b from-accent/60 to-background px-4 py-12 sm:px-6">
          <div className="w-full max-w-sm space-y-6">
            <div className="flex flex-col items-center gap-3 text-center lg:hidden">
              <LogoMark className="size-12" />
              <p className="text-lg font-semibold tracking-tight text-balance">{TAGLINE}</p>
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
            <p className="text-center text-xs text-muted-foreground lg:hidden">{LICENCE_LINE}</p>
          </div>
        </div>
      </main>
    </div>
  )
}

const TAGLINE = "See what your site\u2019s tags really do before consent."
const LICENCE_LINE = "Open source (AGPL-3.0). Audits from the outside."

/** A static picture of what an audit says, drawn in markup so the first screen needs no request. */
function SampleAudit() {
  return (
    <div className="space-y-4 rounded-xl border bg-card p-5 shadow-xs">
      <p className="type-label">Example audit</p>
      <div className="space-y-2">
        <p className="flex items-baseline gap-1.5">
          <span className="text-5xl font-semibold tracking-tight tabular-nums">52</span>
          <span className="text-sm text-muted-foreground">/ 100</span>
        </p>
        <BandBar score={52} band="critical" className="h-1.5" />
        <p className="flex items-center gap-2 text-sm font-medium">
          <StatusGlyph meaning="critical" />
          Critical issues
        </p>
      </div>
      <ul className="divide-y rounded-lg border text-sm">
        {SAMPLE_FINDINGS.map(([meaning, title]) => (
          <li key={title} className="flex items-center gap-2 px-3 py-2">
            <StatusGlyph meaning={meaning} />
            {title}
          </li>
        ))}
      </ul>
    </div>
  )
}

const SAMPLE_FINDINGS = [
  ["critical", "Ad or analytics cookies set without consent"],
  ["critical", "Tag fired before consent default"],
  ["warning", "Consent default set after the Google tag"],
] as const
