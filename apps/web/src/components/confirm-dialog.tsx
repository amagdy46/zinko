import { type ComponentProps, type RefObject, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/** Asks before it acts; the caller opens it (from a menu item). It closes when `onConfirm` settles. */
export function ConfirmDialog({
  open,
  onOpenChange,
  label,
  variant,
  title,
  description,
  onConfirm,
  returnFocus,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  label: string
  variant: ComponentProps<typeof Button>["variant"]
  title: string
  description: string
  onConfirm: () => Promise<void>
  /** The control that opened the dialog; the dialog has no trigger of its own to return focus to. */
  returnFocus: RefObject<HTMLElement | null>
}) {
  const [pending, setPending] = useState(false)

  async function confirm() {
    setPending(true)
    await onConfirm()
    setPending(false)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          returnFocus.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant={variant} disabled={pending} onClick={confirm}>
            {label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
