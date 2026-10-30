import { createFileRoute, Link, redirect } from "@tanstack/react-router"
import { type FormEvent, useState } from "react"
import { AuthCard, authLinkClass, SampleReportAside } from "@/components/auth-card"
import { AuthField, FormError } from "@/components/auth-field"
import { Button } from "@/components/ui/button"
import { pageTitle } from "@/lib/page-title"
import { authClient } from "@/lib/auth-client"
import { formField } from "@/lib/form"
import { useHydrated } from "@/lib/use-hydrated"
import { redirectSearch, safeRedirect } from "@/lib/redirect"
import { getSession } from "@/server/session"

export const Route = createFileRoute("/sign-in")({
  head: () => pageTitle("Sign in"),
  validateSearch: redirectSearch,
  beforeLoad: async ({ search }) => {
    if ((await getSession()) !== null) throw redirect({ href: safeRedirect(search.redirect) })
  },
  component: SignIn,
})

function SignIn() {
  const { redirect: next } = Route.useSearch()
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({})
  const [pending, setPending] = useState(false)
  const hydrated = useHydrated()

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const email = formField(form, "email").trim()
    const password = formField(form, "password")
    const invalid = {
      ...(email === "" ? { email: "Enter your email address." } : {}),
      ...(password === "" ? { password: "Enter your password." } : {}),
    }
    setError(null)
    setFieldErrors(invalid)
    if (invalid.email !== undefined || invalid.password !== undefined) {
      document.getElementById(invalid.email === undefined ? "password" : "email")?.focus()
      return
    }
    setPending(true)
    const { error: failure } = await authClient.signIn.email({ email, password })
    if (failure) {
      setError(failure.message ?? "Could not sign in")
      setPending(false)
      document.getElementById("email")?.focus()
      return
    }
    window.location.assign(safeRedirect(next))
  }

  return (
    <AuthCard
      aside={<SampleReportAside />}
      title="Sign in"
      description="Sign in to continue. Zinko checks what a website's tags and consent banner really do."
      footer={
        <>
          No account yet?{" "}
          <Link
            to="/sign-up"
            search={next === undefined ? {} : { redirect: next }}
            className={authLinkClass}
          >
            Sign up
          </Link>
        </>
      }
    >
      <form method="post" noValidate onSubmit={onSubmit} className="space-y-4">
        <AuthField
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          error={fieldErrors.email}
          formError={error !== null}
        />
        <AuthField
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          error={fieldErrors.password}
          formError={error !== null}
        />
        <p className="text-sm">
          <Link
            to="/forgot-password"
            className="inline-flex min-h-8 items-center rounded-sm underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
          >
            Forgot your password?
          </Link>
        </p>
        <FormError message={error} />
        <Button type="submit" className="w-full" disabled={pending || !hydrated}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthCard>
  )
}
