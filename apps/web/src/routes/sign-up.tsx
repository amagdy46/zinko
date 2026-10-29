import { createFileRoute, Link, redirect } from "@tanstack/react-router"
import { type FormEvent, useState } from "react"
import { flushSync } from "react-dom"
import { AuthCard } from "@/components/auth-card"
import { AuthField, FormError } from "@/components/auth-field"
import { Button } from "@/components/ui/button"
import { pageTitle } from "@/lib/page-title"
import { authClient } from "@/lib/auth-client"
import { formField } from "@/lib/form"
import { useHydrated } from "@/lib/use-hydrated"
import { redirectSearch, safeRedirect } from "@/lib/redirect"
import { getSession } from "@/server/session"

export const Route = createFileRoute("/sign-up")({
  head: () => pageTitle("Create account"),
  validateSearch: redirectSearch,
  beforeLoad: async ({ search }) => {
    if ((await getSession()) !== null) throw redirect({ href: safeRedirect(search.redirect) })
  },
  component: SignUp,
})

function SignUp() {
  const { redirect: next } = Route.useSearch()
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<{
    name?: string
    email?: string
    password?: string
  }>({})
  const [pending, setPending] = useState(false)
  const hydrated = useHydrated()

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const name = formField(form, "name").trim()
    const email = formField(form, "email").trim()
    const password = formField(form, "password")
    const invalid = {
      ...(name === "" ? { name: "Enter your name." } : {}),
      ...(email === "" ? { email: "Enter your email address." } : {}),
      ...(password.length < 8 ? { password: "Use 8 or more characters." } : {}),
    }
    setError(null)
    setFieldErrors(invalid)
    const first = (["name", "email", "password"] as const).find((id) => invalid[id] !== undefined)
    if (first !== undefined) {
      document.getElementById(first)?.focus()
      return
    }
    setPending(true)
    const { error: failure } = await authClient.signUp.email({ name, email, password })
    if (failure) {
      flushSync(() => {
        setError(failure.message ?? "Could not create the account")
        setPending(false)
      })
      document.getElementById("form-error")?.focus()
      return
    }
    window.location.assign(safeRedirect(next))
  }

  return (
    <AuthCard
      title="Create an account"
      description="Zinko checks what a website's tags and consent banner really do, so you can see what to fix."
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
      <form method="post" noValidate onSubmit={onSubmit} className="space-y-4">
        <AuthField id="name" label="Name" autoComplete="name" error={fieldErrors.name} />
        <AuthField
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          error={fieldErrors.email}
        />
        <AuthField
          id="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          error={fieldErrors.password}
          hint="8 or more characters."
        />
        <FormError message={error} />
        <Button type="submit" className="w-full" disabled={pending || !hydrated}>
          {pending ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </AuthCard>
  )
}
