import { createFileRoute, useRouter } from "@tanstack/react-router"
import { type FormEvent, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { SettingsSection } from "@/components/settings-section"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save profile"}
        </Button>
      </form>
    </SettingsSection>
  )
}
