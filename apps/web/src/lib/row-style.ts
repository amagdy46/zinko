/** Hover, selected and keyboard-focus look shared by the clickable rows of the run list and the hits table. */
export const selectableRow =
  "cursor-pointer transition-colors duration-150 hover:bg-muted/50 has-focus-visible:bg-muted/50 data-[selected=true]:bg-accent data-[selected=true]:hover:bg-accent data-[selected=true]:[&>td:first-child]:shadow-[inset_2px_0_0_var(--primary)]"

/** A tab-bar link: the active tab has an underline, keyboard focus an inset ring that a scrolling bar cannot clip. */
export const tabLink =
  "inline-flex min-h-8 shrink-0 items-center rounded-sm border-b-2 px-1.5 border-transparent pt-1 pb-2 text-sm whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset data-[status=active]:border-primary data-[status=active]:text-foreground"
