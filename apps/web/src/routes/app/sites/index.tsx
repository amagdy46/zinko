import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { useRef, useState, type FormEvent } from "react"
import { toast } from "sonner"
import { EmptyState } from "@/components/empty-state"
import { FirstRun, LastAudit, OpenFindings } from "@/components/first-run"
import { PageContainer } from "@/components/page-container"
import { PageHeader } from "@/components/page-header"
import { SampleReportLink } from "@/components/sample-report-link"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formField } from "@/lib/form"
import { pageTitle } from "@/lib/page-title"
import { withScheme } from "@/lib/site-url"
import { createSite, listClients, listSites } from "@/server/clients"

const NO_CLIENT = "none"

export const Route = createFileRoute("/app/sites/")({
  head: () => pageTitle("Sites"),
  loader: async ({ context }) => ({
    sites: await listSites(),
    clients: context.groupByClient ? (await listClients()).clients : [],
  }),
  component: Sites,
})

function Sites() {
  const { sites, clients } = Route.useLoaderData()
  const { session, groupByClient } = Route.useRouteContext()
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const opener = useRef<HTMLElement | null>(null)
  const [pending, setPending] = useState(false)
  const [urlError, setUrlError] = useState<string>()
  const [clientId, setClientId] = useState(NO_CLIENT)

  async function addSite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    setPending(true)
    try {
      const result = await createSite({
        data: {
          ...(clientId === NO_CLIENT ? {} : { clientId }),
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
      setClientId(NO_CLIENT)
      setOpen(false)
      await router.navigate({ to: "/app/sites/$siteId", params: { siteId: result.value.id } })
    } finally {
      setPending(false)
    }
  }

  const needle = query.trim().toLocaleLowerCase()
  const filtered = sites.filter(
    (s) =>
      s.name.toLocaleLowerCase().includes(needle) ||
      s.host.toLocaleLowerCase().includes(needle) ||
      (s.client?.name.toLocaleLowerCase().includes(needle) ?? false),
  )
  const audited = sites.some((s) => s.running > 0 || s.latest !== null)
  const unaudited = sites.find((s) => s.running === 0 && s.latest === null)
  return (
    <PageContainer>
      <PageHeader
        title="Sites"
        actions={
          <>
            {sites.length > 0 ? (
              <Input
                aria-label="Search sites"
                placeholder="Search sites…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-44"
              />
            ) : null}
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
              <DialogContent
                onCloseAutoFocus={(event) => {
                  if (opener.current === null) return
                  event.preventDefault()
                  opener.current.focus()
                  opener.current = null
                }}
              >
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
                        addresses). Only the address up to the host is kept: you choose the landing
                        page when you start an audit.
                      </p>
                    ) : (
                      <p id="site-url-error" role="alert" className="text-sm text-destructive">
                        {urlError}
                      </p>
                    )}
                  </div>
                  {groupByClient ? (
                    <div className="space-y-2">
                      <Label htmlFor="site-client">Client</Label>
                      <Select value={clientId} onValueChange={setClientId}>
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
                  ) : null}
                  <Button type="submit" disabled={pending}>
                    {pending ? "Creating…" : "Create site"}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </>
        }
      />
      {sites.length > 0 ? (
        <FirstRun
          organizationId={session.activeOrganizationId ?? ""}
          steps={[
            { label: "Add a site", done: true },
            { label: "Run an audit", done: audited },
          ]}
          next={
            unaudited === undefined || audited ? undefined : (
              <Link
                className="inline-flex h-8 items-center rounded-sm text-sm text-status-active underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
                to="/app/sites/$siteId/audits/new"
                params={{ siteId: unaudited.id }}
              >
                Run your first audit
              </Link>
            )
          }
        />
      ) : (
        <EmptyState
          title="Add your first site"
          description="Add the address of a site, then run your first audit."
          steps={[
            "Add a site address.",
            "Start an audit: Zinko loads the site, accepts or rejects the banner and records every tag.",
            "Read the findings with the evidence behind each one.",
          ]}
          action={
            <Button
              onClick={(event) => {
                opener.current = event.currentTarget
                setOpen(true)
              }}
            >
              Add site
            </Button>
          }
          secondary={<SampleReportLink />}
        />
      )}
      {sites.length > 0 && filtered.length === 0 ? (
        <EmptyState
          title="No matching sites"
          description="Try another name or clear your search."
          action={
            <Button variant="outline" onClick={() => setQuery("")}>
              Clear search
            </Button>
          }
        />
      ) : null}
      {filtered.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Site</TableHead>
              {groupByClient ? <TableHead>Client</TableHead> : null}
              <TableHead>Last audit</TableHead>
              <TableHead>Open findings</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((s) => (
              <TableRow key={s.id} className="relative">
                <TableCell className="font-medium">
                  <Link
                    className="-my-1.5 inline-flex min-h-8 items-center after:absolute after:inset-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                    to="/app/sites/$siteId"
                    params={{ siteId: s.id }}
                  >
                    {s.name}
                  </Link>
                  <span className="block font-mono text-xs font-normal text-muted-foreground">
                    {s.host}
                  </span>
                </TableCell>
                {groupByClient ? (
                  <TableCell>
                    {s.client === null ? (
                      <span className="text-muted-foreground">No client</span>
                    ) : (
                      s.client.name
                    )}
                  </TableCell>
                ) : null}
                <TableCell>
                  <LastAudit latest={s.latest} running={s.running} />
                </TableCell>
                <TableCell>
                  <OpenFindings latest={s.latest} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </PageContainer>
  )
}
