import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"

/**
 * The one content column of a list or form page, left-aligned so every page starts at the same edge as the audit workspace.
 * The audit workspace does not use it: it takes the full width.
 */
export function PageContainer({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("max-w-5xl space-y-6", className)} {...props} />
}
