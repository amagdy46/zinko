import { Skeleton } from "@/components/ui/skeleton"

/** Shown while a route loads: a title and table rows at the real heights, so the page does not jump. */
export function PageSkeleton() {
  return (
    <div className="mx-auto max-w-6xl space-y-6" role="status" aria-label="Loading">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-12 w-full" />
        ))}
      </div>
    </div>
  )
}
