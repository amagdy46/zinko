import { createFileRoute, useRouter } from "@tanstack/react-router"
import { type FormEvent, useState } from "react"
import { toast } from "sonner"
import { AuthField } from "@/components/auth-field"
import { Button } from "@/components/ui/button"
import { SettingsSection } from "@/components/settings-section"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useHydrated } from "@/lib/use-hydrated"
import { pageTitle } from "@/lib/page-title"
import { authClient } from "@/lib/auth-client"
import { formField } from "@/lib/form"

export const Route = createFileRoute("/app/settings/")({
  head: () => pageTitle("Profile", "Settings"),
  component: Profile,
})

function Profile() {
  const { session } = Route.useRouteContext()
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [passwordPending, setPasswordPending] = useState(false)
  const [passwordErrors, setPasswordErrors] = useState<{ current?: string; next?: string }>({})
  const hydrated = useHydrated()

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const currentPassword = formField(data, "current-password")
    const newPassword = formField(data, "new-password")
    const errors = {
      ...(currentPassword === "" ? { current: "Enter your current password." } : {}),
      ...(newPassword.length < 8 ? { next: "Use 8 or more characters." } : {}),
    }
    setPasswordErrors(errors)
    if (errors.current !== undefined || errors.next !== undefined) return
    setPasswordPending(true)
    const { error } = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    })
    setPasswordPending(false)
    if (error) {
      setPasswordErrors({ current: error.message ?? "Could not change your password" })
      return
    }
    form.reset()
    toast.success("Password changed. Other devices were signed out.")
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    const { error } = await authClient.updateUser({
      name: formField(new FormData(event.currentTarget), "name").trim(),
    })
    setPending(false)
    if (error) toast.error(error.message ?? "Could not save your profile")
    else {
      toast.success("Profile saved")
      await router.invalidate()
    }
  }

  return (
    <>
      <SettingsSection
        title="Profile"
        description="Your name is visible to the other members of your organization."
      >
        <form onSubmit={save} className="max-w-xl space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              name="name"
              autoComplete="name"
              defaultValue={session.name}
              required
              pattern=".*\S.*"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="profile-email">Email</Label>
            <Input id="profile-email" value={session.email} readOnly />
          </div>
          <Button type="submit" disabled={pending || !hydrated}>
            {pending ? "Saving…" : "Save profile"}
          </Button>
        </form>
      </SettingsSection>
      <SettingsSection
        title="Password"
        description="Changing it signs you out on your other devices."
      >
        <form onSubmit={changePassword} noValidate className="max-w-xl space-y-4">
          <AuthField
            id="current-password"
            label="Current password"
            type="password"
            autoComplete="current-password"
            error={passwordErrors.current}
          />
          <AuthField
            id="new-password"
            label="New password"
            type="password"
            autoComplete="new-password"
            error={passwordErrors.next}
            hint="8 or more characters."
          />
          <Button type="submit" disabled={passwordPending || !hydrated}>
            {passwordPending ? "Changing…" : "Change password"}
          </Button>
        </form>
      </SettingsSection>
    </>
  )
}
