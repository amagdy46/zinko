import * as React from "react"
import { cn } from "@/lib/utils"
import { Progress as ProgressPrimitive } from "radix-ui"

function Progress({
  className,
  value,
  max = 100,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      max={max}
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-primary/20", className)}
      {...props}
    >
      <progress
        aria-hidden="true"
        max={max}
        value={value ?? undefined}
        data-slot="progress-indicator"
        className="block h-full w-full appearance-none border-0 bg-transparent accent-primary [&::-webkit-progress-bar]:bg-transparent [&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary"
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
