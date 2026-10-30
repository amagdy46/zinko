import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"

/**
 * The one content column of an app page, left-aligned so every page starts at the same edge as the audit workspace. It takes the
 * full width like the workspace; a page of prose or form fields passes `max-w-5xl` so its lines stay readable.
 */
export function PageContainer({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("space-y-6", className)} {...props} />
}
