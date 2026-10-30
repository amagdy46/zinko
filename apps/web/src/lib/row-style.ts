/** The selected state of any row: a fill and a 2px primary rule on the leading edge (a shape, not only a colour). */
export const selectedRule =
  "data-[selected=true]:bg-accent data-[selected=true]:shadow-[inset_2px_0_0_var(--primary)]"

/** Hover, selected and keyboard-focus look shared by the clickable table rows (see `LinkRow` in `components/data-row.tsx`). */
export const selectableRow =
  "cursor-pointer transition-colors duration-150 hover:bg-muted has-focus-visible:bg-muted data-[selected=true]:bg-accent data-[selected=true]:hover:bg-accent data-[selected=true]:[&>td:first-child]:shadow-[inset_2px_0_0_var(--primary)]"

/** A tab-bar link: the active tab has an underline, keyboard focus an inset ring that a scrolling bar cannot clip. */
export const tabLink =
  "inline-flex min-h-8 shrink-0 items-center rounded-sm border-b-2 border-transparent px-2.5 pt-1 pb-2 text-sm whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset data-[status=active]:border-primary data-[status=active]:text-foreground"
