import { Info } from "lucide-react"
import type { Comparison } from "@/lib/compare"
import { noticesOf } from "@/lib/compare-text"

/** What limits the comparison, in one place. */
export function CompareNotices({ comparison }: { comparison: Comparison }) {
  return (
    <div className="flex gap-3 rounded-md border bg-muted/30 p-3 text-sm">
      <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="space-y-1">
        <h2 className="font-medium">What limits this comparison</h2>
        <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
          {noticesOf(comparison).map((notice) => (
            <li key={notice}>{notice}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}
