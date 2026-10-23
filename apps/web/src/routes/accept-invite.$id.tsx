import { createFileRoute, Link } from "@tanstack/react-router"
import { useEffect, useState } from "react"
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
  const [error, setError] = useState<{ id: string; message: string } | null>(null)
  const [loaded, setLoaded] = useState<{
    id: string
    invitation: { organizationName: string; role: string } | null
    error: string | null
  } | null>(null)
  const [pending, setPending] = useState(false)
  const redirect = `/accept-invite/${id}`
  const current = loaded?.id === id ? loaded : null
  const invitation = current?.invitation ?? null
  const shownError = (error?.id === id ? error.message : null) ?? current?.error ?? null
  const loading = session !== null && current === null

  useEffect(() => {
    if (session === null) return undefined
    let active = true
    void authClient.organization
      .getInvitation({ query: { id } })
      .then(({ data, error: failure }) => {
        if (!active) return
        setLoaded({
          id,
          invitation: data ? { organizationName: data.organizationName, role: data.role } : null,
          error: failure
            ? (failure.message ?? "Could not load the invitation. Ask for a new link.")
            : null,
        })
      })
    return () => {
      active = false
    }
  }, [id, session])

  async function accept() {
    setPending(true)
    setError(null)
    const { error: failure } = await authClient.organization.acceptInvitation({ invitationId: id })
    if (failure) {
      setError({ id, message: failure.message ?? "Could not accept the invitation" })
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
      title={invitation === null ? "Join the organization" : `Join ${invitation.organizationName}`}
      description={`You are signed in as ${session.email}. The invitation must have been sent to this address.`}
    >
      {loading ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading invitation…
        </p>
      ) : null}
      {invitation === null ? null : (
        <p className="text-sm">
          You will join <strong>{invitation.organizationName}</strong> as{" "}
          <strong>{invitation.role}</strong>.
        </p>
      )}
      {shownError === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {shownError}
        </p>
      )}
      <Button
        className="w-full"
        onClick={accept}
        disabled={pending || loading || invitation === null}
      >
        {pending ? "Joining…" : "Accept invitation"}
      </Button>
    </AuthCard>
  )
}
