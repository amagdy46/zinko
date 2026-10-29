import { Link } from "@tanstack/react-router"
import { SearchX } from "lucide-react"
import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"

/** What a missing page, or one that belongs to another organization, shows inside the app shell. */
export function NotFound({ what = "Page" }: { what?: string }) {
  return (
    <div className="mx-auto max-w-6xl">
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
    </div>
  )
}
