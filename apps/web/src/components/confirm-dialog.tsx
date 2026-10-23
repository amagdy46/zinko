import { type ComponentProps, useState } from "react"
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
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  label: string
  variant: ComponentProps<typeof Button>["variant"]
  title: string
  description: string
  onConfirm: () => Promise<void>
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
      <DialogContent>
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
