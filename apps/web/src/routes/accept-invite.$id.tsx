import { createFileRoute, Link } from "@tanstack/react-router"
import { useState } from "react"
import { AuthCard } from "@/components/auth-card"
import { Button } from "@/components/ui/button"
import { authClient } from "@/lib/auth-client"
import { getSession } from "@/server/session"

export const Route = createFileRoute("/accept-invite/$id")({
  loader: async () => ({ session: await getSession() }),
  component: AcceptInvite,
})

function AcceptInvite() {
  const { id } = Route.useParams()
  const { session } = Route.useLoaderData()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const redirect = `/accept-invite/${id}`

  async function accept() {
    setPending(true)
    setError(null)
    const { error: failure } = await authClient.organization.acceptInvitation({ invitationId: id })
    if (failure) {
      setError(failure.message ?? "Could not accept the invitation")
      setPending(false)
      return
    }
    window.location.assign("/app")
  }

  if (session === null)
    return (
      <AuthCard
        title="You have been invited"
        description="Sign in or create an account with the invited email address to join."
      >
        <div className="flex gap-2">
          <Button asChild className="flex-1">
            <Link to="/sign-up" search={{ redirect }}>
              Sign up
            </Link>
          </Button>
          <Button asChild variant="outline" className="flex-1">
            <Link to="/sign-in" search={{ redirect }}>
              Sign in
            </Link>
          </Button>
        </div>
      </AuthCard>
    )

  return (
    <AuthCard
      title="Join the organization"
      description={`You are signed in as ${session.email}. The invitation must have been sent to this address.`}
    >
      {error === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button className="w-full" onClick={accept} disabled={pending}>
        Accept invitation
      </Button>
    </AuthCard>
  )
}
