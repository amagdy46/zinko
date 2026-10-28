import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { useState, type FormEvent } from "react"
import { toast } from "sonner"
import { FirstRun, LastAudit, OpenFindings } from "@/components/first-run"
import { EmptyState } from "@/components/empty-state"
import { ScoreSparkline } from "@/components/score-figure"
import { PageContainer } from "@/components/page-container"
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
import { pageTitle } from "@/lib/page-title"
import { formField } from "@/lib/form"
import { createClient, listClients } from "@/server/clients"

export const Route = createFileRoute("/app/clients/")({
  head: () => pageTitle("Clients"),
  loader: () => listClients(),
  component: Clients,
})

function Clients() {
  const clients = Route.useLoaderData()
  const { session } = Route.useRouteContext()
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    try {
      const result = await createClient({
        data: { name: formField(new FormData(event.currentTarget), "name") },
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      setOpen(false)
      await router.navigate({ to: "/app/clients/$clientId", params: { clientId: result.value.id } })
    } finally {
      setPending(false)
    }
  }
  const filtered = clients.filter((c) =>
    c.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  )
  return (
    <PageContainer>
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
            <Dialog open={open} onOpenChange={setOpen}>
              {clients.length > 0 ? (
                <DialogTrigger asChild>
                  <Button>New client</Button>
                </DialogTrigger>
              ) : null}
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>New client</DialogTitle>
                  <DialogDescription>
                    A client groups the sites you audit for one customer.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={create} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="client-name">Name</Label>
                    <Input id="client-name" name="name" required maxLength={100} />
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
        <FirstRun organizationId={session.activeOrganizationId ?? ""} clients={clients} />
      ) : null}
      {clients.length === 0 ? (
        <EmptyState
          title="Add your first client"
          description="Group the sites you audit for one customer, then run your first audit."
          steps={[
            "Add a client, then a site address.",
            "Start an audit: Zinko loads the site, accepts or rejects the banner and records every tag.",
            "Read the findings with the evidence behind each one.",
          ]}
          action={<Button onClick={() => setOpen(true)}>New client</Button>}
        />
      ) : null}
      {clients.length > 0 && filtered.length === 0 ? (
        <EmptyState
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead>Sites</TableHead>
              <TableHead>Last audit</TableHead>
              <TableHead>Open findings</TableHead>
              <TableHead>Last five scores</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((c) => (
              <TableRow key={c.id} className="relative">
                <TableCell className="font-medium">
                  <Link
                    className="after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-ring"
                    to="/app/clients/$clientId"
                    params={{ clientId: c.id }}
                  >
                    {c.name}
                  </Link>
                </TableCell>
                <TableCell className="tabular-nums">{c.siteCount}</TableCell>
                <TableCell>
                  <LastAudit latest={c.latest} running={c.running} />
                </TableCell>
                <TableCell>
                  <OpenFindings latest={c.latest} />
                </TableCell>
                <TableCell>
                  <ScoreSparkline points={c.trend} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </PageContainer>
  )
}
