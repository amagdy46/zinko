import { createFileRoute, redirect } from "@tanstack/react-router"
import { type FormEvent, useState } from "react"
import { AuthCard } from "@/components/auth-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { authClient } from "@/lib/auth-client"
import { formField } from "@/lib/form"
import { getSession } from "@/server/session"

export const Route = createFileRoute("/onboarding")({
  beforeLoad: async () => {
    if ((await getSession()) === null) throw redirect({ to: "/sign-in" })
  },
  component: Onboarding,
})

/** Better Auth wants a unique slug; derive one from the name and make it unique with a suffix. */
const slugify = (name: string) =>
  `${
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "org"
  }-${crypto.randomUUID().slice(0, 6)}`

function Onboarding() {
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = formField(new FormData(event.currentTarget), "name").trim()
    setPending(true)
    setError(null)
    const { error: failure } = await authClient.organization.create({ name, slug: slugify(name) })
    if (failure) {
      setError(failure.message ?? "Could not create the organization")
      setPending(false)
      return
    }
    window.location.assign("/app")
  }

  return (
    <AuthCard
      title="Create your organization"
      description="Organizations hold your members and your data. You can create more later."
    >
      <form method="post" onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Organization name</Label>
          <Input id="name" name="name" placeholder="Acme Inc." required />
        </div>
        {error === null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={pending}>
          Create organization
        </Button>
      </form>
    </AuthCard>
  )
}
