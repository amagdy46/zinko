import { NotFound } from "@/components/not-found"
import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { useRef, useState, type FormEvent } from "react"
import { toast } from "sonner"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { SampleReportLink } from "@/components/sample-report-link"
import { Button } from "@/components/ui/button"
import { MoreHorizontal } from "lucide-react"
import { PageContainer } from "@/components/page-container"
import { PageHeader } from "@/components/page-header"
import { EmptyState } from "@/components/empty-state"
import { LastAudit, OpenFindings } from "@/components/first-run"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
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
import { count, relativeTime } from "@/lib/format"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formField } from "@/lib/form"
import { withScheme } from "@/lib/site-url"
import { archiveClient, createSite, deleteClient, getClient } from "@/server/clients"

export const Route = createFileRoute("/app/clients/$clientId")({
  loader: ({ params }) => getClient({ data: { id: params.clientId } }),
  head: ({ loaderData }) => pageTitle(loaderData?.client.name ?? "Client", "Clients"),
  notFoundComponent: () => <NotFound what="Client" />,
  component: ClientPage,
})

function ClientPage() {
  const { client, sites, canManage } = Route.useLoaderData()
  const router = useRouter()
  const menuButton = useRef<HTMLButtonElement>(null)
  const [confirming, setConfirming] = useState<"archive" | "delete" | null>(null)
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [urlError, setUrlError] = useState<string>()

  async function addSite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    setPending(true)
    try {
      const result = await createSite({
        data: {
          clientId: client.id,
          name: formField(data, "name"),
          url: withScheme(formField(data, "url")),
        },
      })
      if (!result.ok) {
        if (/URL|address/.test(result.message)) setUrlError(result.message)
        else toast.error(result.message)
        return
      }
      setUrlError(undefined)
      form.reset()
      setOpen(false)
      await router.navigate({ to: "/app/sites/$siteId", params: { siteId: result.value.id } })
    } finally {
      setPending(false)
    }
  }

  async function leave(
    action: (args: {
      data: { id: string }
    }) => Promise<{ ok: true } | { ok: false; message: string }>,
  ) {
    const result = await action({ data: { id: client.id } })
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    await router.navigate({ to: "/app/clients" })
  }

  const lastAudit = sites.reduce<Date | string | null>(
    (last, s) =>
      s.lastAuditAt !== null && (last === null || new Date(s.lastAuditAt) > new Date(last))
        ? s.lastAuditAt
        : last,
    null,
  )
  return (
    <PageContainer>
      <PageHeader
        title={client.name}
        breadcrumb={[{ label: "Clients", to: "/app/clients" }, { label: client.name }]}
        meta={
          <>
            {client.archived ? <Badge variant="secondary">Archived</Badge> : null}
            <span>
              {count(sites.length, "site")} ·{" "}
              {lastAudit ? `last audit ${relativeTime(lastAudit).text}` : "Not audited"}
            </span>
          </>
        }
        actions={
          <>
            {!client.archived ? (
              <Dialog
                open={open}
                onOpenChange={(isOpen) => {
                  setOpen(isOpen)
                  if (!isOpen) setUrlError(undefined)
                }}
              >
                {sites.length > 0 ? (
                  <DialogTrigger asChild>
                    <Button>Add site</Button>
                  </DialogTrigger>
                ) : null}
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add site</DialogTitle>
                    <DialogDescription>
                      The site's address decides which pages an audit may visit.
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={addSite} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="site-name">Name</Label>
                      <Input
                        id="site-name"
                        name="name"
                        required
                        maxLength={100}
                        placeholder="Main store"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="site-url">Address</Label>
                      <Input
                        id="site-url"
                        name="url"
                        inputMode="url"
                        autoComplete="off"
                        required
                        placeholder="shop.example"
                        aria-invalid={urlError !== undefined}
                        aria-describedby={urlError === undefined ? undefined : "site-url-error"}
                        onChange={() => setUrlError(undefined)}
                      />
                      {urlError === undefined ? (
                        <p className="text-xs text-muted-foreground">
                          https:// is added when you leave it out (http:// for localhost and private
                          addresses). Only the address up to the host is kept: you choose the
                          landing page when you start an audit.
                        </p>
                      ) : (
                        <p id="site-url-error" role="alert" className="text-sm text-destructive">
                          {urlError}
                        </p>
                      )}
                    </div>
                    <Button type="submit" disabled={pending}>
                      {pending ? "Creating…" : "Create site"}
                    </Button>
                  </form>
                </DialogContent>
              </Dialog>
            ) : null}
            {canManage && !client.archived ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button ref={menuButton} variant="ghost" size="icon" aria-label="Client actions">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
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
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </>
        }
      />
      <ConfirmDialog
        open={confirming === "archive"}
        onOpenChange={(isOpen) => setConfirming(isOpen ? "archive" : null)}
        label="Archive"
        variant="outline"
        title={`Archive ${client.name}?`}
        description="The client and its sites are hidden from the lists. Nothing is deleted."
        returnFocus={menuButton}
        onConfirm={() => leave(archiveClient)}
      />
      <ConfirmDialog
        open={confirming === "delete"}
        onOpenChange={(isOpen) => setConfirming(isOpen ? "delete" : null)}
        label="Delete"
        variant="destructive"
        title={`Delete ${client.name}?`}
        description="The client and its sites are deleted. This cannot be undone."
        returnFocus={menuButton}
        onConfirm={() => leave(deleteClient)}
      />
      {sites.length === 0 ? (
        <EmptyState
          title="Add the site to audit"
          description={
            client.archived
              ? "This client is archived."
              : "Add a site address to start checking its tags and consent."
          }
          action={
            client.archived ? undefined : <Button onClick={() => setOpen(true)}>Add site</Button>
          }
          secondary={client.archived ? undefined : <SampleReportLink />}
        />
      ) : (
        <section aria-labelledby="sites-heading" className="space-y-2">
          <h2 id="sites-heading" className="sr-only">
            Sites
          </h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Site</TableHead>
                <TableHead>Origin</TableHead>
                <TableHead>Last audit</TableHead>
                <TableHead>Open findings</TableHead>
                <TableHead>Audits</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sites.map((s) => (
                <TableRow key={s.id} className="relative">
                  <TableCell className="font-medium">
                    <Link
                      to="/app/sites/$siteId"
                      params={{ siteId: s.id }}
                      className="-my-1.5 inline-flex min-h-8 items-center after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      {s.name}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{s.origin}</TableCell>
                  <TableCell>
                    <LastAudit latest={s.latest} running={s.running} />
                  </TableCell>
                  <TableCell>
                    <OpenFindings latest={s.latest} />
                  </TableCell>
                  <TableCell className="tabular-nums">{s.auditCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}
    </PageContainer>
  )
}
