import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router"
import { SearchX, Users } from "lucide-react"
import { useRef, useState, type FormEvent, type ReactNode } from "react"
import { DataRow, LinkRow, RowChevron, rowLink } from "@/components/data-row"
import { FirstRun, LastAudit, LatestScore, OpenFindings } from "@/components/first-run"
import { EmptyState } from "@/components/empty-state"
import { SampleReportLink } from "@/components/sample-report-link"
import { ScoreSparkline } from "@/components/score-figure"
import { PageShell } from "@/components/page-shell"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { count } from "@/lib/format"
import { pageTitle } from "@/lib/page-title"
import { formField } from "@/lib/form"
import { createClient, listClients } from "@/server/clients"

const nextLink =
  "inline-flex h-8 items-center rounded-sm text-sm text-status-active underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"

export const Route = createFileRoute("/app/clients/")({
  beforeLoad: ({ context }) => {
    if (!context.groupByClient) throw redirect({ to: "/app/sites" })
  },
  head: () => pageTitle("Clients"),
  loader: () => listClients(),
  component: Clients,
})

function Clients() {
  const { clients, ungroupedSites } = Route.useLoaderData()
  const { session } = Route.useRouteContext()
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const opener = useRef<HTMLElement | null>(null)
  const [pending, setPending] = useState(false)
  const [nameError, setNameError] = useState<string>()
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    try {
      const result = await createClient({
        data: { name: formField(new FormData(event.currentTarget), "name") },
      })
      if (!result.ok) {
        setNameError(result.message)
        return
      }
      setNameError(undefined)
      setOpen(false)
      await router.navigate({ to: "/app/clients/$clientId", params: { clientId: result.value.id } })
    } finally {
      setPending(false)
    }
  }
  const clientsWithSites = clients.some((c) => c.siteCount > 0)
  let nextStep: ReactNode = undefined
  if (!clientsWithSites && clients[0] !== undefined) {
    nextStep =
      ungroupedSites > 0 ? (
        <Link className={nextLink} to="/app/sites">
          {ungroupedSites === 1 ? "Move your site to a client" : "Move a site to a client"}
        </Link>
      ) : (
        <Link className={nextLink} to="/app/clients/$clientId" params={{ clientId: clients[0].id }}>
          Add your first site
        </Link>
      )
  }
  const filtered = clients.filter((c) =>
    c.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  )
  return (
    <PageShell>
      <PageHeader
        title="Clients"
        actions={
          <>
            {clients.length > 0 ? (
              <Input
                aria-label="Search clients"
                placeholder="Search clients…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-44"
              />
            ) : null}
            <Dialog
              open={open}
              onOpenChange={(isOpen) => {
                setOpen(isOpen)
                if (!isOpen) setNameError(undefined)
              }}
            >
              {clients.length > 0 ? (
                <DialogTrigger asChild>
                  <Button>New client</Button>
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
                  <DialogTitle>New client</DialogTitle>
                  <DialogDescription>
                    A client groups the sites you audit for one customer.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={create} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="client-name">Name</Label>
                    <Input
                      id="client-name"
                      name="name"
                      required
                      maxLength={100}
                      aria-invalid={nameError !== undefined}
                      aria-describedby={nameError === undefined ? undefined : "client-name-error"}
                      onChange={() => setNameError(undefined)}
                    />
                    {nameError === undefined ? null : (
                      <p id="client-name-error" role="alert" className="text-sm text-destructive">
                        {nameError}
                      </p>
                    )}
                  </div>
                  <Button type="submit" disabled={pending}>
                    {pending ? "Creating…" : "Create client"}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </>
        }
      />
      {clients.length > 0 ? (
        <FirstRun
          organizationId={session.activeOrganizationId ?? ""}
          steps={[
            { label: "Add a client", done: true },
            { label: "Add a site to a client", done: clientsWithSites },
            {
              label: "Run an audit",
              done: clients.some((c) => c.running > 0 || c.latest !== null),
            },
          ]}
          next={nextStep}
        />
      ) : null}
      {clients.length === 0 && ungroupedSites > 0 ? (
        <EmptyState
          icon={Users}
          title="No clients yet"
          description={`Your ${count(ungroupedSites, "site")} ${ungroupedSites === 1 ? "is" : "are"} listed under Sites. Add a client to group sites by customer.`}
          action={
            <Button
              onClick={(event) => {
                opener.current = event.currentTarget
                setOpen(true)
              }}
            >
              New client
            </Button>
          }
          secondary={
            <Link
              to="/app/sites"
              className="inline-flex h-8 items-center rounded-sm px-2 text-sm underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
            >
              Go to Sites
            </Link>
          }
        />
      ) : null}
      {clients.length === 0 && ungroupedSites === 0 ? (
        <EmptyState
          icon={Users}
          title="Add your first client"
          description="Group the sites you audit for one customer, then run your first audit."
          steps={[
            "Add a client, then a site address.",
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
              New client
            </Button>
          }
          secondary={<SampleReportLink />}
        />
      ) : null}
      {clients.length > 0 && filtered.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No matching clients"
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
            {filtered.map((c) => (
              <DataRow key={c.id} className="items-start">
                <div className="min-w-0 flex-1 space-y-2">
                  <div>
                    <Link
                      className={cn(rowLink, "font-medium")}
                      to="/app/clients/$clientId"
                      params={{ clientId: c.id }}
                    >
                      {c.name}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {c.distinguisher === null ? "" : `${c.distinguisher} · `}
                      {count(c.siteCount, "site")}
                    </span>
                  </div>
                  <div className="flex items-start gap-4">
                    <LatestScore latest={c.latest} />
                    <div className="space-y-2">
                      <LastAudit latest={c.latest} running={c.running} />
                      <OpenFindings latest={c.latest} />
                    </div>
                  </div>
                  <ScoreSparkline points={c.trend} />
                </div>
                <RowChevron className="mt-2" />
              </DataRow>
            ))}
          </ul>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Sites</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Last audit</TableHead>
                  <TableHead>Open findings</TableHead>
                  <TableHead>Last five scores</TableHead>
                  <TableHead className="w-8 pl-0">
                    <span className="sr-only">Open</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c) => (
                  <LinkRow key={c.id}>
                    <TableCell className="font-medium">
                      <Link
                        className={cn(rowLink, "-my-1.5")}
                        to="/app/clients/$clientId"
                        params={{ clientId: c.id }}
                      >
                        {c.name}
                      </Link>
                      {c.distinguisher !== null ? (
                        <span className="block text-xs font-normal text-muted-foreground">
                          {c.distinguisher}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="tabular-nums">{c.siteCount}</TableCell>
                    <TableCell>
                      <LatestScore latest={c.latest} />
                    </TableCell>
                    <TableCell>
                      <LastAudit latest={c.latest} running={c.running} />
                    </TableCell>
                    <TableCell>
                      <OpenFindings latest={c.latest} />
                    </TableCell>
                    <TableCell>
                      <ScoreSparkline points={c.trend} />
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
      {clients.length > 0 && ungroupedSites > 0 ? (
        <p className="text-sm text-muted-foreground">
          <Link
            to="/app/sites"
            className="inline-flex min-h-8 items-center rounded-sm underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
          >
            Ungrouped sites
          </Link>{" "}
          · {count(ungroupedSites, "site")} without a client
        </p>
      ) : null}
    </PageShell>
  )
}
