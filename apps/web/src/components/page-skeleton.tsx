import { PageShell } from "@/components/page-shell"
import { Skeleton } from "@/components/ui/skeleton"

/** The title block of `PageHeader`: the breadcrumb row, the title, and an action at the right. */
function HeaderSkeleton({ action = false }: { action?: boolean }) {
  return (
    <div className="space-y-3">
      <div className="h-5" />
      <div className="flex items-start justify-between gap-4">
        <Skeleton className="h-8 w-48" />
        {action ? <Skeleton className="h-9 w-24" /> : null}
      </div>
    </div>
  )
}

/** Shown while a route loads and has no skeleton of its own: a title and table rows at the real heights, so the page does not jump. */
export function PageSkeleton() {
  return (
    <PageShell role="status" aria-label="Loading">
      <HeaderSkeleton />
      <div className="space-y-2">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-12 w-full" />
        ))}
      </div>
    </PageShell>
  )
}

/** The Sites list: header with the add button, a column header and rows as tall as the real ones. */
export function SitesSkeleton() {
  return (
    <PageShell role="status" aria-label="Loading sites">
      <HeaderSkeleton action />
      <div className="divide-y overflow-hidden rounded-lg border border-border-subtle bg-card md:hidden">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="space-y-3 px-3 py-3">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-20" />
            <div className="flex gap-4">
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-14" />
                <Skeleton className="h-[3px] w-24" />
              </div>
              <div className="space-y-1.5">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3.5 w-32" />
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="hidden space-y-px md:block">
        <div className="grid h-9 grid-cols-[2fr_1fr_1fr_2fr_2rem] items-center gap-4 px-2">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-3 w-16" />
          ))}
        </div>
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="grid h-[53px] grid-cols-[2fr_1fr_1fr_2fr_2rem] items-center gap-4 border-t px-2"
          >
            <div className="space-y-1.5">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-14" />
              <Skeleton className="h-[3px] w-24" />
            </div>
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="size-4" />
          </div>
        ))}
      </div>
    </PageShell>
  )
}

/** The audit Overview: the score card with its three tiles, then the cards below it. */
export function OverviewSkeleton() {
  return (
    <div role="status" aria-label="Loading overview" className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-6 rounded-xl border border-border-subtle bg-card p-5 shadow-xs">
        <div className="space-y-3">
          <Skeleton className="h-12 w-28" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-8 w-36" />
        </div>
        <div className="grid grid-cols-3 gap-2 md:w-[36rem]">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-[72px]" />
          ))}
        </div>
      </div>
      <Skeleton className="h-64 w-full rounded-xl" />
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  )
}

/** The Findings split: a list of rows on the left, the detail pane on the right. */
export function FindingsSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading findings"
      className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]"
    >
      <div className="space-y-3">
        <Skeleton className="h-9 w-72 max-w-full" />
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-20 w-full" />
        ))}
      </div>
      <Skeleton className="hidden h-96 w-full rounded-xl lg:block" />
    </div>
  )
}
