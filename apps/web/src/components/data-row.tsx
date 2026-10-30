import { ChevronRight } from "lucide-react"
import type { ComponentProps } from "react"
import { TableRow } from "@/components/ui/table"
import { selectableRow, selectedRule } from "@/lib/row-style"
import { cn } from "@/lib/utils"

/**
 * A row that opens something. The link inside it carries `rowLink`, which stretches it over the
 * whole row, so a click anywhere navigates while the row's own text stays selectable and any
 * other control (a button in the last cell) sits above it with `relative`. Hover and keyboard focus
 * fill the row; `selected` adds the 2px primary rule. Put a `RowChevron` in the last cell.
 */
export function LinkRow({
  selected,
  className,
  ...props
}: ComponentProps<typeof TableRow> & { selected?: boolean }) {
  return (
    <TableRow
      data-selected={selected ? true : undefined}
      className={cn("group/row relative", selectableRow, className)}
      {...props}
    />
  )
}

/** The same row outside a table: a stacked list item for narrow screens and for lists that are not tabular. */
export function DataRow({
  selected,
  className,
  ...props
}: ComponentProps<"li"> & { selected?: boolean }) {
  return (
    <li
      data-selected={selected ? true : undefined}
      className={cn(
        "group/row relative flex cursor-pointer items-center gap-3 border-b px-3 py-3 transition-colors duration-150 last:border-b-0 hover:bg-muted has-focus-visible:bg-muted",
        selectedRule,
        className,
      )}
      {...props}
    />
  )
}

/** On the link of a `LinkRow` or `DataRow`: covers the row and draws the focus ring around all of it, inside the row so a clipping ancestor cannot cut it. */
export const rowLink =
  "inline-flex min-h-8 items-center rounded-sm outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"

/** The trailing hint that a row opens: quiet until the row is hovered or focused. */
export function RowChevron({ className }: { className?: string }) {
  return (
    <ChevronRight
      aria-hidden="true"
      className={cn(
        "size-4 shrink-0 text-muted-foreground transition-colors group-hover/row:text-foreground group-has-focus-visible/row:text-foreground",
        className,
      )}
    />
  )
}
