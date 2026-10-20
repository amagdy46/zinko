import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { toast } from "sonner"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { Button } from "@/components/ui/button"
import { archiveSite, deleteSite, getSite } from "@/server/clients"

export const Route = createFileRoute("/app/sites/$siteId")({
  validateSearch: (search: Record<string, unknown>): { page?: number } =>
    typeof search.page === "number" && search.page > 0 ? { page: Math.floor(search.page) } : {},
  loaderDeps: ({ search }) => ({ page: search.page ?? 0 }),
  loader: ({ params, deps }) => getSite({ data: { id: params.siteId, page: deps.page } }),
  notFoundComponent: () => <p className="text-sm text-muted-foreground">Site not found.</p>,
  component: SitePage,
})

function SitePage() {
  const { site, client, canManage, audits, page, hasMore } = Route.useLoaderData()
  const router = useRouter()

  async function leave(action: typeof archiveSite) {
    const result = await action({ data: { id: site.id } })
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    await router.navigate({ to: "/app/clients/$clientId", params: { clientId: client.id } })
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="flex gap-1 text-sm text-muted-foreground">
          <Link to="/app/clients" className="hover:text-foreground">
            Clients
          </Link>
          <span>/</span>
          <Link
            to="/app/clients/$clientId"
            params={{ clientId: client.id }}
            className="hover:text-foreground"
          >
            {client.name}
          </Link>
        </div>
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold">{site.name}</h1>
          {canManage && !site.archived ? (
            <div className="flex gap-2">
              <ConfirmDialog
                label="Archive"
                variant="outline"
                title={`Archive ${site.name}?`}
                description="The site is hidden from the lists. Nothing is deleted."
                onConfirm={() => leave(archiveSite)}
              />
              <ConfirmDialog
                label="Delete"
                variant="destructive"
                title={`Delete ${site.name}?`}
                description="The site is deleted. This cannot be undone."
                onConfirm={() => leave(deleteSite)}
              />
            </div>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          <span data-testid="site-origin">{site.origin}</span> · host{" "}
          <code data-testid="site-host">{site.host}</code>
          {site.archived ? " · Archived" : ""}
        </p>
      </div>
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Audits</h2>
        {audits.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No audits yet. Run the first audit to see which tags fire on this site.
          </p>
        ) : (
          <ul className="grid max-w-xl gap-2">
            {audits.map((audit) => (
              <li
                key={audit.id}
                className="flex items-center justify-between rounded-md border px-4 py-3 text-sm"
              >
                <time>{new Date(audit.createdAt).toLocaleString()}</time>
                <span className="text-muted-foreground">{audit.status}</span>
              </li>
            ))}
          </ul>
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
      </section>
    </div>
  )
}
