import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { Archive, Globe, SearchX } from "lucide-react"
import { Option, Schema } from "effect"
import { useRef, useState, type FormEvent } from "react"
import { toast } from "sonner"
import { ArchivedSites } from "@/components/archived-sites"
import { EmptyState } from "@/components/empty-state"
import { SitesSkeleton } from "@/components/page-skeleton"
import { DataRow, LinkRow, RowChevron, rowLink } from "@/components/data-row"
import { FirstRun, LastAudit, LatestScore, OpenFindings } from "@/components/first-run"
import { PageShell } from "@/components/page-shell"
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
import { cn } from "@/lib/utils"
import { count } from "@/lib/format"
import { formField } from "@/lib/form"
import { pageTitle } from "@/lib/page-title"
import { originHost, startPathOfAddress, withScheme } from "@/lib/site-url"
import { createSite, listArchived, listClients, listSites } from "@/server/clients"

const NO_CLIENT = "none"
const SEARCH_FROM = 8
const decodeFlag = Schema.decodeUnknownOption(
  Schema.Union([Schema.Literal(true), Schema.Literal("true")]),
)

export const Route = createFileRoute("/app/sites/")({
  validateSearch: (search: Record<string, unknown>): { add?: true; archived?: true } => ({
    ...(Option.isSome(decodeFlag(search.add)) ? { add: true as const } : {}),
    ...(Option.isSome(decodeFlag(search.archived)) ? { archived: true as const } : {}),
  }),
  head: () => pageTitle("Sites"),
  loader: async ({ context }) => ({
    sites: await listSites(),
    archived: await listArchived(),
    clients: context.groupByClient ? (await listClients()).clients : [],
  }),
  pendingComponent: SitesSkeleton,
  component: Sites,
})

function Sites() {
  const { sites, clients, archived } = Route.useLoaderData()
  const { session, groupByClient } = Route.useRouteContext()
  const { add, archived: showArchived } = Route.useSearch()
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const opener = useRef<HTMLElement | null>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const [pending, setPending] = useState(false)
  const [urlError, setUrlError] = useState<string>()
  const [clientId, setClientId] = useState(NO_CLIENT)
  const [address, setAddress] = useState("")
  const startPath = startPathOfAddress(address)
  const keptHost = startPath === null ? null : originHost(new URL(withScheme(address)).origin)

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
      const first = startPath
      setUrlError(undefined)
      form.reset()
      setAddress("")
      setClientId(NO_CLIENT)
      setOpen(false)
      if (first !== null) toast.success(`Site added. Start page set to ${first}.`)
      await (first === null
        ? router.navigate({ to: "/app/sites/$siteId", params: { siteId: result.value.id } })
        : router.navigate({
            to: "/app/sites/$siteId/audits/new",
            params: { siteId: result.value.id },
            search: { start: first },
          }))
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
  const addFirstSite = (
    <Button
      ref={addButton}
      onClick={(event) => {
        opener.current = event.currentTarget
        setOpen(true)
      }}
    >
      Add site
    </Button>
  )
  const noSites =
    archived.sites.length > 0 ? (
      <EmptyState
        icon={Archive}
        title="All your sites are archived"
        description={`You have ${count(archived.sites.length, "archived site")}. Restore one to audit it again, or add a new site.`}
        action={addFirstSite}
        secondary={
          <Button variant="outline" asChild>
            <Link to="/app/sites" search={{ archived: true }}>
              View archived sites
            </Link>
          </Button>
        }
      />
    ) : (
      <EmptyState
        icon={Globe}
        title="Add your first site"
        description="Add the address of a site, then run your first audit."
        steps={[
          "Add a site address.",
          "Start an audit: Zinko loads the site, accepts or rejects the banner and records every tag.",
          "Read the findings with the evidence behind each one.",
        ]}
        action={addFirstSite}
        secondary={<SampleReportLink />}
      />
    )
  const archivedTotal = archived.sites.length + archived.clients.length
  const audited = sites.some((s) => s.running > 0 || s.latest !== null)
  const unaudited = sites.find((s) => s.running === 0 && s.latest === null)
  return (
    <PageShell>
      <PageHeader
        title={showArchived === true ? "Archived" : "Sites"}
        breadcrumb={
          showArchived === true
            ? [{ label: "Sites", to: "/app/sites" }, { label: "Archived" }]
            : undefined
        }
        actions={
          showArchived === true ? undefined : (
            <>
              {archivedTotal > 0 ? (
                <Button variant="ghost" asChild>
                  <Link to="/app/sites" search={{ archived: true }}>
                    Archived ({archivedTotal})
                  </Link>
                </Button>
              ) : null}
              {sites.length >= SEARCH_FROM ? (
                <Input
                  aria-label="Search sites"
                  placeholder="Search sites…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-44"
                />
              ) : null}
              <Dialog
                open={open || add === true}
                onOpenChange={(isOpen) => {
                  setOpen(isOpen)
                  if (!isOpen && add)
                    void router.navigate({ to: "/app/sites", search: {}, replace: true })
                  if (!isOpen) setUrlError(undefined)
                }}
              >
                {sites.length > 0 ? (
                  <DialogTrigger asChild>
                    <Button ref={addButton}>Add site</Button>
                  </DialogTrigger>
                ) : null}
                <DialogContent
                  onCloseAutoFocus={(event) => {
                    event.preventDefault()
                    ;(opener.current ?? addButton.current)?.focus()
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
                        placeholder="Example: Company website"
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
                        onChange={(event) => {
                          setUrlError(undefined)
                          setAddress(event.target.value)
                        }}
                      />
                      {startPath !== null && urlError === undefined ? (
                        <p role="status" className="text-sm">
                          The site is <span className="font-mono">{keptHost}</span>. Your first
                          audit starts on <span className="font-mono break-all">{startPath}</span>;
                          you can change that before it runs.
                        </p>
                      ) : null}
                      {urlError === undefined ? (
                        <p className="text-xs text-muted-foreground">
                          https:// is added when you leave it out (http:// for localhost and private
                          addresses). A site is a host, not a page: you choose the landing page when
                          you start an audit.
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
          )
        }
      />
      {showArchived === true ? (
        <ArchivedSites archived={archived} groupByClient={groupByClient} />
      ) : (
        <>
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
            noSites
          )}
          {sites.length > 0 && filtered.length === 0 ? (
            <EmptyState
              icon={SearchX}
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
            <>
              <ul className="overflow-hidden rounded-lg border border-border-subtle bg-card shadow-xs md:hidden">
                {filtered.map((s) => (
                  <DataRow key={s.id} className="items-start">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div>
                        <Link
                          className={cn(rowLink, "font-medium")}
                          to="/app/sites/$siteId"
                          params={{ siteId: s.id }}
                        >
                          {s.name}
                        </Link>
                        <span className="block font-mono text-xs text-muted-foreground">
                          {s.host}
                        </span>
                        {groupByClient ? (
                          <span className="block text-xs text-muted-foreground">
                            {s.client === null ? "No client" : s.client.name}
                          </span>
                        ) : null}
                      </div>
                      <div className="flex items-start gap-4">
                        <LatestScore latest={s.latest} />
                        <div className="space-y-2">
                          <LastAudit latest={s.latest} running={s.running} />
                          <OpenFindings latest={s.latest} />
                        </div>
                      </div>
                    </div>
                    <RowChevron className="mt-2" />
                  </DataRow>
                ))}
              </ul>
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Site</TableHead>
                      {groupByClient ? <TableHead>Client</TableHead> : null}
                      <TableHead>Score</TableHead>
                      <TableHead>Last audit</TableHead>
                      <TableHead>Open findings</TableHead>
                      <TableHead className="w-8">
                        <span className="sr-only">Open</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((s) => (
                      <LinkRow key={s.id}>
                        <TableCell>
                          <Link
                            className={cn(rowLink, "-my-1.5 font-medium")}
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
                          <LatestScore latest={s.latest} />
                        </TableCell>
                        <TableCell>
                          <LastAudit latest={s.latest} running={s.running} />
                        </TableCell>
                        <TableCell>
                          <OpenFindings latest={s.latest} />
                        </TableCell>
                        <TableCell className="pl-0">
                          <RowChevron />
                        </TableCell>
                      </LinkRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          ) : null}
        </>
      )}
    </PageShell>
  )
}
