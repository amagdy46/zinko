import { createFileRoute, Link } from "@tanstack/react-router"
import { type FormEvent, useState } from "react"
import { AuthCard } from "@/components/auth-card"
import { AuthField, FormError } from "@/components/auth-field"
import { Button } from "@/components/ui/button"
import { pageTitle } from "@/lib/page-title"
import { authClient } from "@/lib/auth-client"
import { formField } from "@/lib/form"
import { useHydrated } from "@/lib/use-hydrated"

export const Route = createFileRoute("/forgot-password")({
  head: () => pageTitle("Reset your password"),
  component: ForgotPassword,
})

const backToSignIn = (
  <Link
    to="/sign-in"
    className="inline-flex min-h-8 items-center rounded-sm underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
  >
    Back to sign in
  </Link>
)

function ForgotPassword() {
  const [error, setError] = useState<string | null>(null)
  const [emailError, setEmailError] = useState<string>()
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const hydrated = useHydrated()

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const email = formField(new FormData(event.currentTarget), "email").trim()
    setError(null)
    if (email === "") {
      setEmailError("Enter your email address.")
      return
    }
    setEmailError(undefined)
    setPending(true)
    const { error: failure } = await authClient.requestPasswordReset({
      email,
      redirectTo: "/reset-password",
    })
    setPending(false)
    if (failure) {
      setError(failure.message ?? "Could not send the email. Try again.")
      return
    }
    setSentTo(email)
  }

  if (sentTo !== null)
    return (
      <AuthCard
        title="Check your email"
        description={`If ${sentTo} has an account, we sent a link to choose a new password. It expires in an hour.`}
        footer={backToSignIn}
      >
        <Button variant="outline" className="w-full" onClick={() => setSentTo(null)}>
          Use another address
        </Button>
      </AuthCard>
    )

  return (
    <AuthCard
      title="Reset your password"
      description="Enter the email address of your account and we will send you a link to choose a new password."
      footer={backToSignIn}
    >
      <form method="post" noValidate onSubmit={onSubmit} className="space-y-4">
        <AuthField
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          error={emailError}
          formError={error !== null}
        />
        <FormError message={error} />
        <Button type="submit" className="w-full" disabled={pending || !hydrated}>
          {pending ? "Sending…" : "Send reset link"}
        </Button>
      </form>
    </AuthCard>
  )
}
