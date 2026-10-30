import { Link, useRouter } from "@tanstack/react-router"
import { useState } from "react"
import { toast } from "sonner"
import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { relativeTime } from "@/lib/format"
import { unarchiveClient, unarchiveSite } from "@/server/clients"

type Archived = {
  canManage: boolean
  sites: ReadonlyArray<{
    id: string
    name: string
    host: string
    archivedAt: Date | string | null
    client: { id: string; name: string; archived: boolean } | null
  }>
  clients: ReadonlyArray<{ id: string; name: string; archivedAt: Date | string | null }>
}

const rowAction =
  "-my-1.5 inline-flex min-h-8 items-center rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"

export function ArchivedSites({
  archived,
  groupByClient,
}: {
  archived: Archived
  groupByClient: boolean
}) {
  const router = useRouter()
  const [restoring, setRestoring] = useState<string | null>(null)

  async function restore(
    id: string,
    name: string,
    action: typeof unarchiveSite | typeof unarchiveClient,
  ) {
    setRestoring(id)
    try {
      const result = await action({ data: { id } })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(`Restored ${name}`)
      await router.invalidate()
    } finally {
      setRestoring(null)
    }
  }

  if (archived.sites.length === 0 && archived.clients.length === 0)
    return (
      <EmptyState
        title="Nothing is archived"
        description="A site or client you archive waits here until you restore it."
        action={
          <Button variant="outline" asChild>
            <Link to="/app/sites">Back to sites</Link>
          </Button>
        }
      />
    )

  return (
    <div className="space-y-6">
      {archived.sites.length > 0 ? (
        <section aria-labelledby="archived-sites" className="space-y-2">
          <h2 id="archived-sites" className="sr-only">
            Archived sites
          </h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Site</TableHead>
                {groupByClient ? <TableHead>Client</TableHead> : null}
                <TableHead>Archived</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {archived.sites.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">
                    <Link className={rowAction} to="/app/sites/$siteId" params={{ siteId: s.id }}>
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
                  <TableCell className="text-sm text-muted-foreground">
                    {s.archivedAt === null ? null : (
                      <time title={relativeTime(s.archivedAt).title}>
                        {relativeTime(s.archivedAt).text}
                      </time>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <RestoreSite
                      site={s}
                      canManage={archived.canManage}
                      restoring={restoring === s.id}
                      onRestore={() => restore(s.id, s.name, unarchiveSite)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ) : null}
      {archived.clients.length > 0 ? (
        <section aria-labelledby="archived-clients" className="space-y-2">
          <h2 id="archived-clients" className="text-sm font-medium">
            Archived clients
          </h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Archived</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {archived.clients.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {c.archivedAt === null ? null : (
                      <time title={relativeTime(c.archivedAt).title}>
                        {relativeTime(c.archivedAt).text}
                      </time>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {archived.canManage ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        disabled={restoring === c.id}
                        onClick={() => restore(c.id, c.name, unarchiveClient)}
                      >
                        {restoring === c.id ? "Restoring…" : "Restore"}
                        <span className="sr-only"> {c.name} and its sites</span>
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ) : null}
    </div>
  )
}

function RestoreSite({
  site,
  canManage,
  restoring,
  onRestore,
}: {
  site: Archived["sites"][number]
  canManage: boolean
  restoring: boolean
  onRestore: () => void
}) {
  if (!canManage)
    return <span className="text-xs text-muted-foreground">An owner or admin can restore it</span>
  if (site.client?.archived === true)
    return <span className="text-xs text-muted-foreground">Restore {site.client.name} first</span>
  return (
    <Button variant="outline" size="sm" className="h-8" disabled={restoring} onClick={onRestore}>
      {restoring ? "Restoring…" : "Restore"}
      <span className="sr-only"> {site.name}</span>
    </Button>
  )
}
