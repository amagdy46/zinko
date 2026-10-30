import { createFileRoute, Link } from "@tanstack/react-router"
import { type FormEvent, useState } from "react"
import { AuthCard } from "@/components/auth-card"
import { AuthField, FormError } from "@/components/auth-field"
import { Button } from "@/components/ui/button"
import { pageTitle } from "@/lib/page-title"
import { authClient } from "@/lib/auth-client"
import { formField } from "@/lib/form"
import { useHydrated } from "@/lib/use-hydrated"

export const Route = createFileRoute("/reset-password")({
  head: () => pageTitle("Choose a new password"),
  validateSearch: (search: Record<string, unknown>): { token?: string; error?: string } => ({
    ...(typeof search.token === "string" ? { token: search.token } : {}),
    ...(typeof search.error === "string" ? { error: search.error } : {}),
  }),
  component: ResetPassword,
})

function ResetPassword() {
  const { token, error: linkError } = Route.useSearch()
  const [error, setError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string>()
  const [done, setDone] = useState(false)
  const [pending, setPending] = useState(false)
  const hydrated = useHydrated()

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (token === undefined) return
    const form = new FormData(event.currentTarget)
    const password = formField(form, "password")
    setError(null)
    if (password.length < 8) {
      setPasswordError("Use 8 or more characters.")
      return
    }
    if (password !== formField(form, "confirm")) {
      setPasswordError("The two passwords do not match.")
      return
    }
    setPasswordError(undefined)
    setPending(true)
    const { error: failure } = await authClient.resetPassword({ newPassword: password, token })
    setPending(false)
    if (failure) {
      setError(failure.message ?? "Could not change the password. Ask for a new link.")
      return
    }
    setDone(true)
  }

  if (token === undefined || linkError !== undefined)
    return (
      <AuthCard
        title="This link does not work"
        description="The reset link is invalid or has expired. Ask for a new one."
      >
        <Button asChild className="w-full">
          <Link to="/forgot-password">Send a new link</Link>
        </Button>
      </AuthCard>
    )

  if (done)
    return (
      <AuthCard
        title="Password changed"
        description="Your password is changed and you were signed out everywhere. Sign in with the new one."
      >
        <Button asChild className="w-full">
          <Link to="/sign-in">Sign in</Link>
        </Button>
      </AuthCard>
    )

  return (
    <AuthCard
      title="Choose a new password"
      description="Pick a password you do not use anywhere else."
    >
      <form method="post" noValidate onSubmit={onSubmit} className="space-y-4">
        <AuthField
          id="password"
          label="New password"
          type="password"
          autoComplete="new-password"
          error={passwordError}
          hint="8 or more characters."
        />
        <AuthField
          id="confirm"
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
        />
        <FormError message={error} />
        <Button type="submit" className="w-full" disabled={pending || !hydrated}>
          {pending ? "Saving…" : "Change password"}
        </Button>
      </form>
    </AuthCard>
  )
}
