import { createFileRoute } from "@tanstack/react-router"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getGreeting } from "@/server/greeting"
import { listNotes } from "@/server/notes"

export const Route = createFileRoute("/app/")({
  loader: async () => ({ greeting: await getGreeting(), notes: await listNotes() }),
  component: Dashboard,
})

function Dashboard() {
  const { session } = Route.useRouteContext()
  const { greeting, notes } = Route.useLoaderData()
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <Card>
        <CardHeader>
          <CardTitle>
            {greeting}, {session.name}
          </CardTitle>
          <CardDescription>
            This text came from a server function running an Effect on the app runtime. You are
            signed in as {session.email}.
          </CardDescription>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Notes</CardTitle>
          <CardDescription>
            Rows from the <code>note</code> table, read through the <code>Database</code> service.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {notes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No notes yet.</p>
          ) : (
            <ul className="space-y-2">
              {notes.map((note) => (
                <li key={note.id} className="flex items-baseline justify-between gap-4 text-sm">
                  <span>{note.title}</span>
                  <time className="text-muted-foreground">
                    {new Date(note.createdAt).toLocaleDateString()}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
