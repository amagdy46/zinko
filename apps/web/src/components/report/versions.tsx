import { useNavigate, useSearch } from "@tanstack/react-router"
import { useRef } from "react"
import { Button } from "@/components/ui/button"
import type { DisclosureLevel } from "@/lib/report-model"
import { ShareDialog } from "./share-dialog"

export interface ReportVersion {
  id: string
  version: number
  publishedAt: string
  publishedByName: string | null
  canDelete: boolean
}

/** What the draft is compared with: the chip's words. */
export const statusOf = (versions: ReadonlyArray<ReportVersion>, changes: boolean) => {
  const latest = versions[0]
  if (latest === undefined) return "Draft, not shared"
  return changes
    ? `Unpublished changes since version ${latest.version}`
    : `Version ${latest.version} published`
}

/** The report's status chip and the Share button; the dialog opens from `?share=1` too. */
export function Versions({
  auditId,
  versions,
  changes,
  detail,
}: {
  auditId: string
  versions: ReadonlyArray<ReportVersion>
  changes: boolean
  detail: DisclosureLevel
}) {
  const navigate = useNavigate()
  const open = useSearch({ from: "/app/audits/$auditId/report", select: (s) => s.share === 1 })
  const opener = useRef<HTMLButtonElement>(null)
  const setOpen = (next: boolean) =>
    navigate({
      to: "/app/audits/$auditId/report",
      params: { auditId },
      search: next ? { share: 1 } : {},
      replace: true,
    })
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm print:hidden">
      <span
        className="inline-flex h-8 items-center rounded-md border px-3"
        data-testid="report-status"
      >
        {statusOf(versions, changes)}
      </span>
      <Button
        ref={opener}
        type="button"
        size="sm"
        onClick={() => setOpen(true)}
        data-testid="share-report"
      >
        Share
      </Button>
      <ShareDialog
        auditId={auditId}
        open={open}
        onOpenChange={setOpen}
        detail={detail}
        latestVersion={versions[0]?.version ?? null}
        changes={changes}
        returnFocus={opener}
      />
    </div>
  )
}
