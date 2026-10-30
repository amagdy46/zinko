import { JOURNEY_STEPS } from "@repo/core/audit"
import { useRouter } from "@tanstack/react-router"
import { type ReactNode, type RefObject, useEffect, useState } from "react"
import { AuditLink } from "@/components/audit-link"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { runBreakdown } from "@/lib/audit-labels"
import { carryOverText } from "@/lib/carry-over"
import { count } from "@/lib/format"
import { previewRerun, rerunAudit } from "@/server/audits"

type Preview = Awaited<ReturnType<typeof previewRerun>>

/**
 * Re-runs an audit with its stored settings. Opened from the audit header or a site history row, so
 * it hands focus back to that control (`returnFocus`) instead of owning a trigger.
 */
export function RerunDialog({
  auditId,
  open,
  onOpenChange,
  returnFocus,
}: {
  auditId: string
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
        <RerunBody auditId={auditId} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

/** Mounted only while the dialog is open, so every opening reads the audit afresh. */
function RerunBody({ auditId, onClose }: { auditId: string; onClose: () => void }) {
  const router = useRouter()
  const [preview, setPreview] = useState<Preview | null>(null)
  const [failed, setFailed] = useState(false)
  const [message, setMessage] = useState<string>()
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let current = true
    previewRerun({ data: { auditId } }).then(
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
  }, [auditId])

  async function confirm() {
    setPending(true)
    try {
      const result = await rerunAudit({ data: { auditId } })
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

  let description: ReactNode = "Loading the settings..."
  if (failed) description = "The re-run could not be prepared. Try again."
  if (preview !== null) {
    const { config, baseline } = preview
    const breakdown = runBreakdown({
      pages: config.pages.length,
      scenarios: config.scenarios.length,
      viewports: config.viewports.length,
      journeySteps:
        config.journey === true && config.pages.length > 1
          ? Math.min(config.pages.length - 1, JOURNEY_STEPS)
          : 0,
      crossHostRuns: config.crossHost === true ? (config.measuredHosts?.length ?? 0) : 0,
    })
    const carried = preview.carryOver === null ? "" : carryOverText(preview.carryOver)
    let comparison: ReactNode =
      "There is no earlier evaluated audit with the same pages, scenarios and viewports to compare it with."
    if (baseline !== null)
      comparison =
        baseline.id === auditId ? (
          "It will be compared with this audit."
        ) : (
          <>
            It will be compared with <AuditLink audit={baseline} onNavigate={onClose} />.
          </>
        )
    description = (
      <>
        {count(breakdown.runs, "run")}, {breakdown.duration}, with the same settings. {comparison}
        {baseline === null || carried === "" ? "" : ` Carried over from it: ${carried}.`}
      </>
    )
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Re-run this audit?</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      {preview?.unavailable ? (
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
        <Button
          disabled={pending || preview === null || preview.unavailable !== null}
          onClick={confirm}
        >
          {pending ? "Starting..." : "Re-run"}
        </Button>
      </DialogFooter>
    </>
  )
}
