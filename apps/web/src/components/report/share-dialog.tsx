import { useRouter } from "@tanstack/react-router"
import { Copy } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { relativeTime, shortDateTime, useTimeZone } from "@/lib/format"
import type { DisclosureLevel } from "@/lib/report-model"
import { deleteSnapshot } from "@/server/report-publish"
import { createShareLink, listShares, revokeShare } from "@/server/report-share"

const EXPIRIES = [
  { value: "7", label: "7 days", days: 7 },
  { value: "30", label: "30 days", days: 30 },
  { value: "90", label: "90 days", days: 90 },
  { value: "never", label: "Never", days: null },
] as const

/** `null` (Never) is a real answer, so this is a lookup by value, not a fallback on the result. */
const DAYS: Record<(typeof EXPIRIES)[number]["value"], (typeof EXPIRIES)[number]["days"]> = {
  "7": 7,
  "30": 30,
  "90": 90,
  never: null,
}

type Versions = Extract<Awaited<ReturnType<typeof listShares>>, { ok: true }>["value"]

const expiryText = (expiresAt: Date | string | null, timeZone: string | undefined) =>
  expiresAt === null ? ", never expires" : `, expires ${shortDateTime(expiresAt, timeZone)}`

const STATUS = { active: "Active", expired: "Expired", revoked: "Turned off" } as const

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success("Link copied")
  } catch {
    toast.error("Could not copy the link. Select it and copy it by hand.")
  }
}

/**
 * Creates a link to the report (publishing a new version when something changed) and manages the
 * links and versions of this audit. The link is shown once; only its hash is stored.
 */
function ShareBody({
  auditId,
  detail,
  latestVersion,
  changes,
}: {
  auditId: string
  detail: DisclosureLevel
  latestVersion: number | null
  changes: boolean
}) {
  const router = useRouter()
  const timeZone = useTimeZone()
  const [label, setLabel] = useState("")
  const [expiry, setExpiry] = useState<(typeof EXPIRIES)[number]["value"]>("30")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ url: string; version: number } | null>(null)
  const [versions, setVersions] = useState<Versions>([])
  const [target, setTarget] = useState<Versions[number] | null>(null)
  const deleteOpener = useRef<HTMLButtonElement>(null)

  const load = useCallback(async () => {
    const result = await listShares({ data: { auditId } })
    if (result.ok) setVersions(result.value)
  }, [auditId])

  useEffect(() => {
    let current = true
    void listShares({ data: { auditId } }).then((result) => {
      if (current && result.ok) setVersions(result.value)
    })
    return () => {
      current = false
    }
  }, [auditId])

  const nextVersion = changes || latestVersion === null ? (latestVersion ?? 0) + 1 : latestVersion

  async function create() {
    setPending(true)
    setError(null)
    const result = await createShareLink({
      data: {
        auditId,
        label,
        expiresInDays: DAYS[expiry],
      },
    })
    setPending(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setCreated(result.value)
    setLabel("")
    await load()
    await router.invalidate()
  }

  async function revoke(id: string) {
    const result = await revokeShare({ data: { shareId: id } })
    if (!result.ok) setError(result.message)
    await load()
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Share report</DialogTitle>
        <DialogDescription>
          Anyone with the link can read this version without signing in. You can turn it off at any
          time.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4 text-sm">
        <div className="space-y-1.5">
          <Label htmlFor="share-label">Label (only you see it)</Label>
          <Input
            id="share-label"
            value={label}
            maxLength={80}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="For example: Acme marketing team"
          />
        </div>
        <fieldset className="space-y-1.5">
          <legend className="font-medium">Link expires</legend>
          <RadioGroup
            value={expiry}
            onValueChange={(next) => {
              const found = EXPIRIES.find((e) => e.value === next)
              if (found !== undefined) setExpiry(found.value)
            }}
            className="flex flex-wrap gap-x-4 gap-y-1"
          >
            {EXPIRIES.map((e) => (
              <div key={e.value} className="flex h-8 items-center gap-2">
                <RadioGroupItem value={e.value} id={`expiry-${e.value}`} />
                <Label htmlFor={`expiry-${e.value}`}>{e.label}</Label>
              </div>
            ))}
          </RadioGroup>
        </fieldset>
        <p className="text-muted-foreground" data-testid="share-preflight">
          {detail === "detailed"
            ? "Pages print as their paths, and ad-platform IDs are included."
            : "Pages print as Page 1, Page 2; no page paths or ad-platform IDs."}{" "}
          {changes || latestVersion === null
            ? `This publishes version ${nextVersion}.`
            : `Nothing changed, so this link opens version ${nextVersion}.`}
        </p>
        {error === null ? null : (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <Button type="button" disabled={pending} onClick={create} data-testid="create-link">
          Create link
        </Button>
        {created === null ? null : (
          <div className="space-y-1.5 rounded-md border p-3" data-testid="created-link">
            <p className="font-medium">Version {created.version}</p>
            <div className="flex items-center gap-2">
              <Input readOnly value={created.url} aria-label="Report link" className="min-w-0" />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Copy link"
                onClick={() => copy(created.url)}
              >
                <Copy />
              </Button>
            </div>
            <p className="text-muted-foreground">
              This link is shown once. Create another to send it again.
            </p>
          </div>
        )}
        {versions.length === 0 ? null : (
          <div className="space-y-3" data-testid="share-versions">
            <h3 className="font-medium">Versions</h3>
            {versions.map((v) => (
              <div key={v.id} className="space-y-1.5 rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p>
                    <span className="font-medium">Version {v.version}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {shortDateTime(v.publishedAt, timeZone)}
                      {v.publishedByName === null ? "" : ` · ${v.publishedByName}`}
                    </span>
                  </p>
                  {v.canDelete ? (
                    <Button
                      ref={deleteOpener}
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setTarget(v)}
                      data-testid={`delete-version-${v.version}`}
                    >
                      Delete this version
                    </Button>
                  ) : null}
                </div>
                {v.links.length === 0 ? (
                  <p className="text-muted-foreground">No links.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {v.links.map((l) => (
                      <li
                        key={l.id}
                        className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
                        data-testid="share-link"
                      >
                        <span className="min-w-0 [overflow-wrap:anywhere]">
                          <span className="font-medium">{l.label ?? "Link"}</span>
                          <span className="text-muted-foreground">
                            {" "}
                            · {STATUS[l.status]}
                            {l.status === "active" ? expiryText(l.expiresAt, timeZone) : ""}
                            {` · opened ${l.viewCount} ${l.viewCount === 1 ? "time" : "times"}`}
                            {l.lastViewedAt === null
                              ? ""
                              : `, last ${relativeTime(l.lastViewedAt).text}`}
                            {l.createdByName === null ? "" : ` · by ${l.createdByName}`}
                          </span>
                        </span>
                        {l.status === "active" ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => revoke(l.id)}
                          >
                            Turn off
                          </Button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(next) => {
          if (!next) setTarget(null)
        }}
        label="Delete this version"
        variant="destructive"
        title={`Delete version ${target?.version ?? ""}?`}
        description="Every link to this version stops working and the stored copy of the report and its logo is removed. This cannot be undone."
        returnFocus={deleteOpener}
        onConfirm={async () => {
          if (target === null) return
          const result = await deleteSnapshot({ data: { snapshotId: target.id } })
          if (!result.ok) setError(result.message)
          await load()
          await router.invalidate()
        }}
      />
    </>
  )
}

/** The share dialog: its content mounts when it opens, so every opening starts clean. */
export function ShareDialog({
  open,
  onOpenChange,
  returnFocus,
  ...rest
}: {
  auditId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  detail: DisclosureLevel
  latestVersion: number | null
  changes: boolean
  returnFocus: React.RefObject<HTMLElement | null>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          returnFocus.current?.focus()
        }}
      >
        <ShareBody {...rest} />
      </DialogContent>
    </Dialog>
  )
}
