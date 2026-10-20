import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import type { FormEvent } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formField } from "@/lib/form"
import { createClient, listClients } from "@/server/clients"

export const Route = createFileRoute("/app/clients/")({
  loader: () => listClients(),
  component: Clients,
})

function Clients() {
  const clients = Route.useLoaderData()
  const router = useRouter()

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const result = await createClient({ data: { name: formField(new FormData(form), "name") } })
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    form.reset()
    await router.navigate({ to: "/app/clients/$clientId", params: { clientId: result.value.id } })
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Clients</h1>
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>New client</CardTitle>
          <CardDescription>A client groups the sites you audit for one customer.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={create} className="flex items-end gap-2">
            <div className="flex-1 space-y-2">
              <Label htmlFor="client-name">Name</Label>
              <Input id="client-name" name="name" required maxLength={100} />
            </div>
            <Button type="submit">Create client</Button>
          </form>
        </CardContent>
      </Card>
      {clients.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No clients yet. Create your first client to add a site and run an audit.
        </p>
      ) : (
        <ul className="grid max-w-xl gap-2">
          {clients.map((client) => (
            <li key={client.id}>
              <Link
                to="/app/clients/$clientId"
                params={{ clientId: client.id }}
                className="flex items-center justify-between rounded-md border px-4 py-3 text-sm hover:bg-accent"
              >
                <span className="font-medium">{client.name}</span>
                <span className="text-muted-foreground">
                  {client.siteCount} {client.siteCount === 1 ? "site" : "sites"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
