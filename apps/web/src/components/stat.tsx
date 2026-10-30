import type { ComponentProps } from "react"
import { StatusGlyph, type StatusMeaning } from "@/components/status-glyph"
import { cn } from "@/lib/utils"

/**
 * A figure with a label: one label line that never wraps, then the number and its unit on the
 * baseline of the tile. Every tile is 72px tall whatever its label, so a row of them lines up.
 * Wrap it in a link (give the link `group/stat`) when it opens a filtered view.
 */
export function Stat({
  glyph,
  label,
  value,
  unit,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children"> & {
  glyph?: StatusMeaning
  label: string
  value: number | string
  unit?: string
}) {
  return (
    <div
      data-slot="stat"
      className={cn(
        "grid h-[72px] min-w-0 grid-rows-[auto_1fr] rounded-lg border border-border-subtle bg-card px-3 py-2.5 shadow-xs transition-colors group-hover/stat:bg-accent",
        className,
      )}
      {...props}
    >
      <p className="type-label flex items-center gap-1.5 truncate">
        {glyph === undefined ? null : <StatusGlyph meaning={glyph} />}
        <span className="truncate">{label}</span>
        <span className="sr-only">: </span>
      </p>
      <p className="flex items-end gap-1.5 text-2xl leading-none font-semibold tabular-nums">
        {value}
        <span className="sr-only"> </span>
        {unit === undefined ? null : (
          <span className="pb-px text-xs font-normal text-muted-foreground">{unit}</span>
        )}
      </p>
    </div>
  )
}
