import { useRouter } from "@tanstack/react-router"
import { useRef, useState } from "react"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { Button } from "@/components/ui/button"
import { shortDateTime, useTimeZone } from "@/lib/format"
import { deleteSnapshot, publishReport } from "@/server/report-publish"

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

/** Publishes the draft as a frozen version and lists the versions, each with "Delete this version". */
export function Versions({
  auditId,
  versions,
  changes,
}: {
  auditId: string
  versions: ReadonlyArray<ReportVersion>
  changes: boolean
}) {
  const router = useRouter()
  const timeZone = useTimeZone()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [target, setTarget] = useState<ReportVersion | null>(null)
  const publishRef = useRef<HTMLButtonElement>(null)
  const latest = versions[0]

  async function publish() {
    setPending(true)
    setError(null)
    const result = await publishReport({ data: { auditId } })
    setPending(false)
    if (!result.ok) setError(result.message)
    else await router.invalidate()
  }

  return (
    <div className="space-y-2 text-sm print:hidden" data-testid="versions-panel">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="inline-flex h-8 items-center rounded-md border px-3"
          data-testid="report-status"
        >
          {statusOf(versions, changes)}
        </span>
        <Button
          ref={publishRef}
          type="button"
          size="sm"
          disabled={pending}
          onClick={publish}
          data-testid="publish"
        >
          {latest === undefined || changes
            ? `Publish version ${(latest?.version ?? 0) + 1}`
            : "Publish"}
        </Button>
      </div>
      {error === null ? null : (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {versions.length === 0 ? null : (
        <ul className="space-y-1" aria-label="Published versions">
          {versions.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-medium">Version {v.version}</span>
              <span className="text-muted-foreground">
                published {shortDateTime(v.publishedAt, timeZone)}
                {v.publishedByName === null ? "" : ` by ${v.publishedByName}`}
              </span>
              {v.canDelete ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setTarget(v)}
                  data-testid={`delete-version-${v.version}`}
                >
                  Delete this version
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null)
        }}
        label="Delete this version"
        variant="destructive"
        title={`Delete version ${target?.version ?? ""}?`}
        description="Every link to this version stops working and the stored copy of the report and its logo is removed. This cannot be undone."
        returnFocus={publishRef}
        onConfirm={async () => {
          if (target === null) return
          const result = await deleteSnapshot({ data: { snapshotId: target.id } })
          if (!result.ok) setError(result.message)
          else await router.invalidate()
        }}
      />
    </div>
  )
}
