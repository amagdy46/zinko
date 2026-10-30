import { CircleHelp } from "lucide-react"
import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

/** The one way to say "how do I read this view": a `?` button that opens a short note. */
export function HelpPopover({
  label = "How to read this",
  children,
}: {
  label?: string
  children: ReactNode
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={label} title={label}>
          <CircleHelp aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)] text-sm">
        {children}
      </PopoverContent>
    </Popover>
  )
}
