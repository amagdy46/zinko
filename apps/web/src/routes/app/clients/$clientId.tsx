import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import type { FormEvent } from "react"
import { toast } from "sonner"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formField } from "@/lib/form"
import { archiveClient, createSite, deleteClient, getClient } from "@/server/clients"

export const Route = createFileRoute("/app/clients/$clientId")({
  loader: ({ params }) => getClient({ data: { id: params.clientId } }),
  notFoundComponent: () => <p className="text-sm text-muted-foreground">Client not found.</p>,
  component: ClientPage,
})

function ClientPage() {
  const { client, sites, canManage } = Route.useLoaderData()
  const router = useRouter()

  async function addSite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const result = await createSite({
      data: { clientId: client.id, name: formField(data, "name"), url: formField(data, "url") },
    })
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    form.reset()
    await router.navigate({ to: "/app/sites/$siteId", params: { siteId: result.value.id } })
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

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link to="/app/clients" className="text-sm text-muted-foreground hover:text-foreground">
          Clients
        </Link>
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold">{client.name}</h1>
          {canManage && !client.archived ? (
            <div className="flex gap-2">
              <ConfirmDialog
                label="Archive"
                variant="outline"
                title={`Archive ${client.name}?`}
                description="The client and its sites are hidden from the lists. Nothing is deleted."
                onConfirm={() => leave(archiveClient)}
              />
              <ConfirmDialog
                label="Delete"
                variant="destructive"
                title={`Delete ${client.name}?`}
                description="The client and its sites are deleted. This cannot be undone."
                onConfirm={() => leave(deleteClient)}
              />
            </div>
          ) : null}
        </div>
        {client.archived ? <p className="text-sm text-muted-foreground">Archived</p> : null}
      </div>
      {client.archived ? null : (
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>New site</CardTitle>
            <CardDescription>
              The site's address decides which pages an audit may visit.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={addSite} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="site-name">Name</Label>
                <Input id="site-name" name="name" required maxLength={100} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="site-url">Address</Label>
                <Input
                  id="site-url"
                  name="url"
                  type="url"
                  required
                  placeholder="https://shop.example"
                />
              </div>
              <Button type="submit">Create site</Button>
            </form>
          </CardContent>
        </Card>
      )}
      {sites.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No sites yet. Add the first site of this client to start auditing.
        </p>
      ) : (
        <ul className="grid max-w-xl gap-2">
          {sites.map((site) => (
            <li key={site.id}>
              <Link
                to="/app/sites/$siteId"
                params={{ siteId: site.id }}
                className="flex items-center justify-between rounded-md border px-4 py-3 text-sm hover:bg-accent"
              >
                <span>
                  <span className="font-medium">{site.name}</span>{" "}
                  <span className="text-muted-foreground">{site.origin}</span>
                </span>
                <span className="text-muted-foreground">
                  {site.auditCount} {site.auditCount === 1 ? "audit" : "audits"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
