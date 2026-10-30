import { NotFound } from "@/components/not-found"
import { siteReturn, siteTrail } from "@/lib/site-trail"
import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { useRef, useState, type FormEvent } from "react"
import { MoreHorizontal } from "lucide-react"
import { Schema } from "effect"
import { toast } from "sonner"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { RerunDialog } from "@/components/rerun-dialog"
import { ScoreFigure } from "@/components/score-figure"
import { StatusBadge, toBadgeStatus } from "@/components/status-badge"
import { PageContainer } from "@/components/page-container"
import { PageHeader } from "@/components/page-header"
import { SectionHeading } from "@/components/section-heading"
import { EmptyState } from "@/components/empty-state"
import { SampleReportLink } from "@/components/sample-report-link"
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
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
import { pageTitle } from "@/lib/page-title"
import { count, relativeTime, shortDateTime, useTimeZone } from "@/lib/format"
import { formField } from "@/lib/form"
import { withScheme } from "@/lib/site-url"
import { Button } from "@/components/ui/button"
import {
  archiveSite,
  deleteSite,
  getSite,
  listClients,
  renameSite,
  unarchiveSite,
  updateMeasuredHosts,
  updateSiteClient,
  updateSiteAddress,
} from "@/server/clients"

const NO_CLIENT = "none"

const Page = Schema.Int.check(Schema.isGreaterThan(0))

export const Route = createFileRoute("/app/sites/$siteId")({
  validateSearch: (search: Record<string, unknown>): { page?: number } =>
    Schema.is(Page)(search.page) ? { page: search.page } : {},
  loaderDeps: ({ search }) => ({ page: search.page ?? 0 }),
  loader: async ({ params, deps, context }) => {
    const found = await getSite({ data: { id: params.siteId, page: deps.page } })
    const clients = context.groupByClient && found.canManage ? (await listClients()).clients : []
    return { ...found, clients }
  },
  head: ({ loaderData }) => pageTitle(loaderData?.site.name ?? "Site", "Sites"),
  notFoundComponent: () => <NotFound what="Site" />,
  component: SitePage,
})

function SitePage() {
  const { site, client, clients, canManage, hasAudits, audits, page, hasMore } =
    Route.useLoaderData()
  const { groupByClient } = Route.useRouteContext()
  const router = useRouter()
  const menuButton = useRef<HTMLButtonElement>(null)
  const [confirming, setConfirming] = useState<"archive" | "delete" | null>(null)
  const [editing, setEditing] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [nameError, setNameError] = useState<string>()
  const [pending, setPending] = useState(false)
  const [rerunOf, setRerunOf] = useState<string | null>(null)
  const [rerunOpen, setRerunOpen] = useState(false)
  const rerunButton = useRef<HTMLButtonElement>(null)
  const [urlError, setUrlError] = useState<string>()
  const [declaring, setDeclaring] = useState(false)
  const [moving, setMoving] = useState(false)
  const [destination, setDestination] = useState(NO_CLIENT)
  const [hostsError, setHostsError] = useState<string>()
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

  async function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    try {
      const result = await renameSite({
        data: { id: site.id, name: formField(new FormData(event.currentTarget), "name") },
      })
      if (!result.ok) {
        setNameError(result.message)
        return
      }
      setRenaming(false)
      toast.success("Site renamed")
      await router.invalidate()
    } finally {
      setPending(false)
    }
  }

  async function saveHosts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    try {
      const result = await updateMeasuredHosts({
        data: {
          id: site.id,
          hosts: formField(new FormData(event.currentTarget), "hosts").split("\n"),
        },
      })
      if (!result.ok) {
        setHostsError(result.message)
        return
      }
      setDeclaring(false)
      toast.success("Other hosts saved")
      await router.invalidate()
    } finally {
      setPending(false)
    }
  }

  async function saveClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    try {
      const result = await updateSiteClient({
        data: { siteId: site.id, clientId: destination === NO_CLIENT ? null : destination },
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      setMoving(false)
      toast.success("Client saved")
      await router.invalidate()
    } finally {
      setPending(false)
    }
  }

  async function restore() {
    const result = await unarchiveSite({ data: { id: site.id } })
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    toast.success(`Restored ${site.name}`)
    await router.invalidate()
  }

  async function leave(action: typeof archiveSite | typeof deleteSite) {
    const result = await action({ data: { id: site.id } })
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    if (action === archiveSite)
      toast.success(`Archived ${site.name}`, {
        duration: 10000,
        action: { label: "Undo", onClick: () => void restore() },
      })
    await router.navigate(siteReturn(groupByClient, client))
  }

  return (
    <PageContainer>
      <PageHeader
        title={site.name}
        breadcrumb={[...siteTrail(groupByClient, client), { label: site.name }]}
        description={
          <>
            <span className="font-mono break-all" data-testid="site-origin">
              {site.origin}
            </span>
            {site.archived ? (
              <span className="mt-1 block text-sm">
                This site is archived.{" "}
                {canManage
                  ? "Restore it to run audits again."
                  : "An owner or admin can restore it."}
              </span>
            ) : null}
            {groupByClient ? (
              <span className="mt-1 block text-sm" data-testid="site-client">
                {client === null ? "No client" : `Client: ${client.name}`}
              </span>
            ) : null}
            {site.measuredHosts.length === 0 ? null : (
              <span className="mt-1 block text-sm" data-testid="site-measured-hosts">
                Also measured on <span className="font-mono">{site.measuredHosts.join(", ")}</span>
              </span>
            )}
          </>
        }
        meta={site.archived ? <Badge variant="secondary">Archived</Badge> : undefined}
        actions={
          <>
            {site.archived && canManage ? (
              <Button variant="outline" onClick={() => void restore()}>
                Restore
              </Button>
            ) : null}
            {!site.archived && audits.length > 0 ? (
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
                  <DropdownMenuItem onSelect={() => setRenaming(true)}>Rename</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setEditing(true)}>
                    Edit address
                  </DropdownMenuItem>
                  {canManage ? (
                    <>
                      <DropdownMenuItem onSelect={() => setDeclaring(true)}>
                        Other hosts
                      </DropdownMenuItem>
                      {groupByClient ? (
                        <DropdownMenuItem
                          onSelect={() => {
                            setDestination(client?.id ?? NO_CLIENT)
                            setMoving(true)
                          }}
                        >
                          Change client
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuItem onSelect={() => setConfirming("archive")}>
                        Archive
                      </DropdownMenuItem>
                      {hasAudits ? null : (
                        <DropdownMenuItem
                          variant="destructive"
                          className="text-destructive"
                          onSelect={() => setConfirming("delete")}
                        >
                          Delete
                        </DropdownMenuItem>
                      )}
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </>
        }
      />
      <Dialog
        open={renaming}
        onOpenChange={(isOpen) => {
          setRenaming(isOpen)
          if (!isOpen) setNameError(undefined)
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            menuButton.current?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename site</DialogTitle>
            <DialogDescription>
              The new name shows on the next report. Reports already published keep the name they
              were published with.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveName} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="site-rename">Name</Label>
              <Input
                id="site-rename"
                name="name"
                required
                maxLength={100}
                autoComplete="off"
                defaultValue={site.name}
                aria-invalid={nameError !== undefined}
                aria-describedby={nameError === undefined ? undefined : "site-rename-error"}
                onChange={() => setNameError(undefined)}
              />
              {nameError === undefined ? null : (
                <p id="site-rename-error" role="alert" className="text-sm text-destructive">
                  {nameError}
                </p>
              )}
            </div>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save name"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
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
      <Dialog
        open={declaring}
        onOpenChange={(isOpen) => {
          setDeclaring(isOpen)
          if (!isOpen) setHostsError(undefined)
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            menuButton.current?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle>Other hosts</DialogTitle>
            <DialogDescription>
              Only add hosts where a visitor should not be asked for consent again and where your
              tags should recognise them. Zinko may open them and any of their subdomains. Enter the
              host a link actually arrives at: www.shop.example and shop.example are different
              hosts. At most 3, one per line.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveHosts} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="site-hosts">Hosts</Label>
              <Textarea
                id="site-hosts"
                name="hosts"
                rows={3}
                autoComplete="off"
                defaultValue={site.measuredHosts.join("\n")}
                placeholder="checkout.shop.example"
                className="font-mono text-sm"
                aria-invalid={hostsError !== undefined}
                aria-describedby={hostsError === undefined ? undefined : "site-hosts-error"}
                onChange={() => setHostsError(undefined)}
              />
              {hostsError === undefined ? null : (
                <p id="site-hosts-error" role="alert" className="text-sm text-destructive">
                  {hostsError}
                </p>
              )}
            </div>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save hosts"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={moving} onOpenChange={setMoving}>
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            menuButton.current?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle>Change client</DialogTitle>
            <DialogDescription>
              The next report names the new client. Published reports keep the client they had.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveClient} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="site-client">Client</Label>
              <Select value={destination} onValueChange={setDestination}>
                <SelectTrigger id="site-client" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CLIENT}>No client</SelectItem>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={pending || destination === (client?.id ?? NO_CLIENT)}>
              {pending ? "Saving…" : "Save client"}
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
        description={
          hasAudits
            ? "This site has audits, so it cannot be deleted. Archiving hides it from the lists and keeps its audits and reports. You can restore it from the Archived view on Sites."
            : "The site is hidden from the lists. Nothing is deleted, and you can restore it from the Archived view on Sites."
        }
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
          secondary={<SampleReportLink />}
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
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {audits.map((a) => (
              <TableRow key={a.id} className="relative">
                <TableCell>
                  <Link
                    to="/app/audits/$auditId"
                    params={{ auditId: a.id }}
                    className="-my-1.5 inline-flex min-h-8 items-center after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <time title={relativeTime(a.createdAt).text}>
                      {shortDateTime(a.createdAt, timeZone)}
                    </time>
                  </Link>
                  <span className="block text-xs text-muted-foreground">
                    {a.kind === "narrow"
                      ? `Re-check of ${a.recheckTitle ?? "one check"}`
                      : count(a.pages, "page")}
                    {a.kind !== "narrow" && a.startPath !== null ? ` · ${a.startPath}` : ""}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={toBadgeStatus(a.status)} />
                    {a.kind === "narrow" ? <Badge variant="outline">Re-check</Badge> : null}
                  </span>
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
                  {a.score === null || a.coverage === null ? (
                    <span className="text-muted-foreground">–</span>
                  ) : (
                    <ScoreFigure score={a.score} coverage={a.coverage} />
                  )}
                </TableCell>
                <TableCell>
                  <AuditFindings audit={a} />
                </TableCell>
                <TableCell className="text-right">
                  {a.hasBaseline ? (
                    <Link
                      to="/app/audits/$auditId/compare"
                      params={{ auditId: a.id }}
                      className="relative inline-flex h-8 items-center rounded-sm px-2 text-sm underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                      Compare
                    </Link>
                  ) : null}
                  {a.kind === "full" && (a.status === "complete" || a.status === "partial") ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="relative h-8"
                      disabled={site.archived}
                      onClick={(event) => {
                        rerunButton.current = event.currentTarget
                        setRerunOf(a.id)
                        setRerunOpen(true)
                      }}
                    >
                      Re-run
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {rerunOf === null ? null : (
        <RerunDialog
          auditId={rerunOf}
          open={rerunOpen}
          onOpenChange={setRerunOpen}
          returnFocus={rerunButton}
        />
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
    </PageContainer>
  )
}

function AuditFindings({
  audit,
}: {
  audit: {
    kind: string
    narrowRuleId: string | null
    status: string
    findings: { critical: number; warning: number; info: number; couldNotCheck: number } | null
  }
}) {
  if (audit.status === "running" || audit.status === "queued") {
    return <span className="text-xs text-muted-foreground">Checks are still to come</span>
  }
  if (audit.kind === "narrow") {
    return <span className="text-xs text-muted-foreground">Not scored: it covers one check</span>
  }
  if (audit.findings === null) {
    return <span className="text-xs text-muted-foreground">Not evaluated</span>
  }
  return <FindingCounts counts={audit.findings} />
}
