import { NotFound } from "@/components/not-found"
import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { useRef, useState, type FormEvent } from "react"
import { MoreHorizontal } from "lucide-react"
import { Schema } from "effect"
import { toast } from "sonner"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { StatusBadge, toBadgeStatus } from "@/components/status-badge"
import { PageHeader } from "@/components/page-header"
import { SectionHeading } from "@/components/section-heading"
import { EmptyState } from "@/components/empty-state"
import { FindingCounts } from "@/components/first-run"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { count, relativeTime, shortDateTime, useTimeZone } from "@/lib/format"
import { formField } from "@/lib/form"
import { withScheme } from "@/lib/site-url"
import { Button } from "@/components/ui/button"
import { archiveSite, deleteSite, getSite, updateSiteAddress } from "@/server/clients"

const Page = Schema.Int.check(Schema.isGreaterThan(0))

export const Route = createFileRoute("/app/sites/$siteId")({
  validateSearch: (search: Record<string, unknown>): { page?: number } =>
    Schema.is(Page)(search.page) ? { page: search.page } : {},
  loaderDeps: ({ search }) => ({ page: search.page ?? 0 }),
  loader: ({ params, deps }) => getSite({ data: { id: params.siteId, page: deps.page } }),
  notFoundComponent: () => <NotFound what="Site" />,
  component: SitePage,
})

function SitePage() {
  const { site, client, canManage, audits, page, hasMore } = Route.useLoaderData()
  const router = useRouter()
  const menuButton = useRef<HTMLButtonElement>(null)
  const [confirming, setConfirming] = useState<"archive" | "delete" | null>(null)
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState(false)
  const [urlError, setUrlError] = useState<string>()
  const timeZone = useTimeZone()

  async function saveAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    try {
      const result = await updateSiteAddress({
        data: { id: site.id, url: withScheme(formField(new FormData(event.currentTarget), "url")) },
      })
      if (!result.ok) {
        setUrlError(result.message)
        return
      }
      setEditing(false)
      toast.success("Address saved")
      await router.invalidate()
    } finally {
      setPending(false)
    }
  }

  async function leave(action: typeof archiveSite) {
    const result = await action({ data: { id: site.id } })
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    await router.navigate({ to: "/app/clients/$clientId", params: { clientId: client.id } })
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={site.name}
        breadcrumb={[
          { label: "Clients", to: "/app/clients" },
          { label: client.name, to: "/app/clients/$clientId", params: { clientId: client.id } },
          { label: site.name },
        ]}
        description={
          <span className="font-mono break-all" data-testid="site-origin">
            {site.origin}
          </span>
        }
        meta={site.archived ? <Badge variant="secondary">Archived</Badge> : undefined}
        actions={
          <>
            {!site.archived ? (
              <Button asChild>
                <Link to="/app/sites/$siteId/audits/new" params={{ siteId: site.id }}>
                  New audit
                </Link>
              </Button>
            ) : null}
            {!site.archived ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button ref={menuButton} variant="ghost" size="icon" aria-label="Site actions">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setEditing(true)}>
                    Edit address
                  </DropdownMenuItem>
                  {canManage ? (
                    <>
                      <DropdownMenuItem onSelect={() => setConfirming("archive")}>
                        Archive
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        className="text-destructive"
                        onSelect={() => setConfirming("delete")}
                      >
                        Delete
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </>
        }
      />
      <Dialog
        open={editing}
        onOpenChange={(isOpen) => {
          setEditing(isOpen)
          if (!isOpen) setUrlError(undefined)
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            menuButton.current?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle>Edit address</DialogTitle>
            <DialogDescription>
              Audits only visit pages on this address. A site with audits can switch between http://
              and https:// but keeps its host; earlier audits keep the URLs they captured.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveAddress} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="site-address">Address</Label>
              <Input
                id="site-address"
                name="url"
                inputMode="url"
                autoComplete="off"
                required
                defaultValue={site.origin}
                className="font-mono text-sm"
                aria-invalid={urlError !== undefined}
                aria-describedby={urlError === undefined ? undefined : "site-address-error"}
                onChange={() => setUrlError(undefined)}
              />
              {urlError === undefined ? null : (
                <p id="site-address-error" role="alert" className="text-sm text-destructive">
                  {urlError}
                </p>
              )}
            </div>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save address"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirming === "archive"}
        onOpenChange={(isOpen) => setConfirming(isOpen ? "archive" : null)}
        label="Archive"
        variant="outline"
        title={`Archive ${site.name}?`}
        description="The site is hidden from the lists. Nothing is deleted."
        returnFocus={menuButton}
        onConfirm={() => leave(archiveSite)}
      />
      <ConfirmDialog
        open={confirming === "delete"}
        onOpenChange={(isOpen) => setConfirming(isOpen ? "delete" : null)}
        label="Delete"
        variant="destructive"
        title={`Delete ${site.name}?`}
        description="The site is deleted. This cannot be undone."
        returnFocus={menuButton}
        onConfirm={() => leave(deleteSite)}
      />
      <SectionHeading title="Audits" />
      {audits.length === 0 ? (
        <EmptyState
          title="No audits yet"
          description="Run the first audit to see which tags fire on this site."
          action={
            site.archived ? undefined : (
              <Button asChild>
                <Link to="/app/sites/$siteId/audits/new" params={{ siteId: site.id }}>
                  New audit
                </Link>
              </Button>
            )
          }
        />
      ) : (
        <Table data-testid="audit-history">
          <TableHeader>
            <TableRow>
              <TableHead>Started</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Runs</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Findings</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {audits.map((a) => (
              <TableRow key={a.id} className="relative">
                <TableCell>
                  <Link
                    to="/app/audits/$auditId"
                    params={{ auditId: a.id }}
                    className="after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <time title={relativeTime(a.createdAt).text}>
                      {shortDateTime(a.createdAt, timeZone)}
                    </time>
                  </Link>
                </TableCell>
                <TableCell>
                  <StatusBadge status={toBadgeStatus(a.status)} />
                </TableCell>
                <TableCell className="tabular-nums">
                  {a.runs.finished} of {a.runs.total}
                  {a.runs.incomplete > 0 ? (
                    <span className="block text-xs text-muted-foreground">
                      {count(a.runs.incomplete, "run")} could not finish
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="tabular-nums">
                  {a.score === null ? (
                    <span className="text-muted-foreground">–</span>
                  ) : (
                    <>
                      {a.score}/100
                      <span className="block text-xs text-muted-foreground">
                        from {count(a.runs.total, "run")}
                      </span>
                    </>
                  )}
                </TableCell>
                <TableCell>
                  <AuditFindings audit={a} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {page > 0 || hasMore ? (
        <div className="flex gap-2">
          {page > 0 ? (
            <Button variant="outline" size="sm" asChild>
              <Link
                to="/app/sites/$siteId"
                params={{ siteId: site.id }}
                search={{ page: page - 1 }}
              >
                Newer
              </Link>
            </Button>
          ) : null}
          {hasMore ? (
            <Button variant="outline" size="sm" asChild>
              <Link
                to="/app/sites/$siteId"
                params={{ siteId: site.id }}
                search={{ page: page + 1 }}
              >
                Older
              </Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function AuditFindings({
  audit,
}: {
  audit: {
    status: string
    findings: { critical: number; warning: number; info: number; couldNotCheck: number } | null
  }
}) {
  if (audit.status === "running" || audit.status === "queued") {
    return <span className="text-xs text-muted-foreground">Checks are still to come</span>
  }
  if (audit.findings === null) {
    return <span className="text-xs text-muted-foreground">Not evaluated</span>
  }
  return <FindingCounts counts={audit.findings} />
}
