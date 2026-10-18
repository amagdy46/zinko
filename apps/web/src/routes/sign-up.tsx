import { createFileRoute, Link, redirect } from "@tanstack/react-router"
import { type FormEvent, useState } from "react"
import { AuthCard } from "@/components/auth-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { authClient } from "@/lib/auth-client"
import { formField } from "@/lib/form"
import { redirectSearch, safeRedirect } from "@/lib/redirect"
import { getSession } from "@/server/session"

export const Route = createFileRoute("/sign-up")({
  validateSearch: redirectSearch,
  beforeLoad: async ({ search }) => {
    if ((await getSession()) !== null) throw redirect({ href: safeRedirect(search.redirect) })
  },
  component: SignUp,
})

function SignUp() {
  const { redirect: next } = Route.useSearch()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setPending(true)
    setError(null)
    const { error: failure } = await authClient.signUp.email({
      name: formField(form, "name"),
      email: formField(form, "email"),
      password: formField(form, "password"),
    })
    if (failure) {
      setError(failure.message ?? "Could not create the account")
      setPending(false)
      return
    }
    window.location.assign(safeRedirect(next))
  }

  return (
    <AuthCard
      title="Create an account"
      description="Start with an email and a password."
      footer={
        <>
          Already have an account?{" "}
          <Link
            to="/sign-in"
            search={next === undefined ? {} : { redirect: next }}
            className="underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      <form method="post" onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" autoComplete="name" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>
        {error === null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={pending}>
          Create account
        </Button>
      </form>
    </AuthCard>
  )
}
