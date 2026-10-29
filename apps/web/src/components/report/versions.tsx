import { useNavigate, useSearch } from "@tanstack/react-router"
import { type ReactNode, useRef } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
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

const dotClass = (shared: boolean, changes: boolean) => {
  if (!shared) return "border border-muted-foreground"
  return changes ? "bg-sev-warning" : "bg-primary"
}

/** The report's status chip, the Share button and the toolbar beside them; the dialog opens from `?share=1` too. */
export function Versions({
  auditId,
  versions,
  changes,
  carriedNotes,
  detail,
  incomplete,
  children,
}: {
  auditId: string
  versions: ReadonlyArray<ReportVersion>
  changes: boolean
  carriedNotes: number
  detail: DisclosureLevel
  incomplete: boolean
  /** The report's other controls, on the same row as the status. */
  children?: ReactNode
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
        className="inline-flex h-8 items-center gap-2 rounded-full bg-muted px-3 text-xs"
        data-testid="report-status"
      >
        <span
          aria-hidden="true"
          className={cn("size-2 shrink-0 rounded-full", dotClass(versions.length > 0, changes))}
        />
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
        carriedNotes={carriedNotes}
        incomplete={incomplete}
        returnFocus={opener}
      />
      {children}
    </div>
  )
}
