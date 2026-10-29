import { createFileRoute, useRouter } from "@tanstack/react-router"
import { type FormEvent, useState } from "react"
import { toast } from "sonner"
import { SettingsSection } from "@/components/settings-section"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { pageTitle } from "@/lib/page-title"
import { getOrgSetting, saveOrgSetting } from "@/server/org-setting"

export const Route = createFileRoute("/app/settings/organization")({
  head: () => pageTitle("Organization", "Settings"),
  loader: () => getOrgSetting(),
  component: OrganizationSettings,
})

function OrganizationSettings() {
  const setting = Route.useLoaderData()
  const router = useRouter()
  const [grouping, setGrouping] = useState(setting.groupByClient)
  const [saving, setSaving] = useState(false)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    try {
      const result = await saveOrgSetting({ data: { groupByClient: grouping } })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success("Organization saved")
      await router.invalidate()
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsSection
      title="Sites and clients"
      description="How this organization lists what it audits."
    >
      {setting.canManage ? (
        <form onSubmit={save} className="max-w-xl space-y-4">
          <div className="flex items-start gap-3">
            <Checkbox
              id="group-by-client"
              checked={grouping}
              disabled={saving}
              onCheckedChange={(value) => setGrouping(value === true)}
              className="mt-1.5"
            />
            <div className="space-y-1">
              <Label htmlFor="group-by-client" className="min-h-8">
                Group sites by client
              </Label>
              <p className="text-sm text-muted-foreground">
                Off by default. Turn it on if you audit sites for clients: Clients appears in the
                menu beside Sites, sites belong to a client and reports can name it. Sites you have
                not given a client stay listed under Sites.
              </p>
            </div>
          </div>
          <Button type="submit" disabled={saving || grouping === setting.groupByClient}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </form>
      ) : (
        <p className="max-w-xl text-sm text-muted-foreground">
          {setting.groupByClient
            ? "This organization groups its sites by client."
            : "This organization lists its sites without clients."}{" "}
          Only owners and admins can change this.
        </p>
      )}
    </SettingsSection>
  )
}
