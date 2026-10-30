import { useRouter } from "@tanstack/react-router"
import { type RefObject, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { count } from "@/lib/format"
import { previewRecheck, recheck } from "@/server/recheck"

type Preview = Awaited<ReturnType<typeof previewRecheck>>

/**
 * Re-checks the pages and scenarios a check failed on (or changed on), as a small `narrow` audit.
 * Opened from a finding or a Compare row, so it hands focus back to that control.
 */
export function RecheckDialog({
  auditId,
  ruleId,
  title,
  against,
  verify,
  open,
  onOpenChange,
  returnFocus,
}: {
  auditId: string
  ruleId: string
  /** The check's title, so the dialog names what is re-checked. */
  title: string
  against?: string
  /** Opened from a finding ("Re-check this finding") rather than from a change in Compare ("Re-check these pages"). */
  verify: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  returnFocus: RefObject<HTMLElement | null>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          returnFocus.current?.focus()
        }}
      >
        <RecheckBody
          auditId={auditId}
          ruleId={ruleId}
          title={title}
          against={against}
          verify={verify}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

/** Mounted only while the dialog is open, so every opening reads the audit afresh. */
function RecheckBody({
  auditId,
  ruleId,
  title,
  against,
  verify,
  onClose,
}: {
  auditId: string
  ruleId: string
  title: string
  against: string | undefined
  verify: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const [preview, setPreview] = useState<Preview | null>(null)
  const [failed, setFailed] = useState(false)
  const [message, setMessage] = useState<string>()
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let current = true
    previewRecheck({
      data: { auditId, ruleId, ...(against === undefined ? {} : { against }) },
    }).then(
      (result) => {
        if (current) setPreview(result)
      },
      () => {
        if (current) setFailed(true)
      },
    )
    return () => {
      current = false
    }
  }, [auditId, ruleId, against])

  async function confirm() {
    setPending(true)
    try {
      const result = await recheck({
        data: { auditId, ruleId, ...(against === undefined ? {} : { against }) },
      })
      if (!result.ok) {
        setMessage(result.message)
        return
      }
      onClose()
      await router.navigate({
        to: "/app/audits/$auditId",
        params: { auditId: result.value.auditId },
      })
    } finally {
      setPending(false)
    }
  }

  let description = "Loading the pages..."
  if (failed) description = "The re-check could not be prepared. Try again."
  if (preview !== null) {
    const { summary } = preview
    if (summary === null) description = preview.unavailable ?? "Nothing to re-check."
    else {
      const extra =
        summary.bannerRuns > 0
          ? ` (${count(summary.bannerRuns, "extra run")} to detect the cookie banner)`
          : ""
      const dropped =
        summary.dropped > 0
          ? ` ${count(summary.dropped, "run")} can no longer be re-checked as it was captured.`
          : ""
      description = `${count(summary.runs, "run")}${extra}, ${summary.duration}, on the ${count(summary.pages, "page")} where this check ${verify ? "fails" : "changed"}.${dropped} The result is shown as a re-check of this audit, not as a new audit of the site.`
    }
  }
  const blocked = preview === null || preview.summary === null || preview.unavailable !== null

  return (
    <>
      <DialogHeader>
        <DialogTitle>{verify ? "Re-check this finding?" : "Re-check these pages?"}</DialogTitle>
        <p className="text-sm font-medium [overflow-wrap:anywhere]">{title}</p>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      {preview?.unavailable && preview.summary !== null ? (
        <p role="alert" className="text-sm text-muted-foreground">
          {preview.unavailable}
        </p>
      ) : null}
      {message === undefined ? null : (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={pending || blocked} onClick={() => void confirm()}>
          {pending ? "Starting..." : "Re-check"}
        </Button>
      </DialogFooter>
    </>
  )
}
