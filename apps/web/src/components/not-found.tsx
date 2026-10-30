import { Link } from "@tanstack/react-router"
import { SearchX } from "lucide-react"
import { PageShell } from "@/components/page-shell"
import { AuthCard } from "@/components/auth-card"
import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"

/** What a missing page, or one that belongs to another organization, shows inside the app shell. */
export function NotFound({ what = "Page" }: { what?: string }) {
  return (
    <PageShell>
      <EmptyState
        icon={SearchX}
        title={`${what} not found`}
        description="It may have moved, or it belongs to another organization."
        action={
          <Button asChild>
            <Link to="/app">Go to the app</Link>
          </Button>
        }
      />
    </PageShell>
  )
}

/** What a mistyped or stale address outside the app shows (a root-level 404), in the same shell as sign-in. */
export function RootNotFound() {
  return (
    <AuthCard
      title="Page not found"
      description="The address may be mistyped, or the link may have expired or moved."
    >
      <Button asChild className="w-full">
        <Link to="/">Go to Zinko</Link>
      </Button>
    </AuthCard>
  )
}
