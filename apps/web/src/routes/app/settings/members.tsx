import { createFileRoute } from "@tanstack/react-router"
import { type FormEvent, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { authClient } from "@/lib/auth-client"
import { formField } from "@/lib/form"

export const Route = createFileRoute("/app/settings/members")({ component: Members })

const roles = ["member", "admin", "owner"] as const
const inviteRoles = ["member", "admin"] as const

const selectClass =
  "h-9 rounded-md border bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"

const inviteLink = (invitationId: string) =>
  `${window.location.origin}/accept-invite/${invitationId}`

async function copy(text: string) {
  await navigator.clipboard.writeText(text)
  toast.success("Link copied")
}

async function cancel(invitationId: string) {
  const { error } = await authClient.organization.cancelInvitation({ invitationId })
  if (error) toast.error(error.message ?? "Could not cancel the invitation")
}

const isRole = (value: string): value is (typeof roles)[number] =>
  roles.some((role) => role === value)

function Members() {
  const { session } = Route.useRouteContext()
  const { data: org } = authClient.useActiveOrganization()
  const [link, setLink] = useState<string | null>(null)

  if (!org) return <p className="text-sm text-muted-foreground">Loading members...</p>

  const me = org.members.find((member) => member.userId === session.userId)
  const canManage = me?.role === "owner" || me?.role === "admin"
  const pending = org.invitations.filter((invitation) => invitation.status === "pending")

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const role = data.get("role") === "admin" ? "admin" : "member"
    const { data: created, error } = await authClient.organization.inviteMember({
      email: formField(data, "email"),
      role,
      organizationId: org?.id,
    })
    if (error || !created) {
      toast.error(error?.message ?? "Could not create the invitation")
      return
    }
    form.reset()
    setLink(inviteLink(created.id))
  }

  async function changeRole(memberId: string, role: (typeof roles)[number]) {
    const { error } = await authClient.organization.updateMemberRole({
      memberId,
      role,
      organizationId: org?.id,
    })
    if (error) toast.error(error.message ?? "Could not change the role")
  }

  async function remove(memberId: string) {
    const { error } = await authClient.organization.removeMember({
      memberIdOrEmail: memberId,
      organizationId: org?.id,
    })
    if (error) toast.error(error.message ?? "Could not remove the member")
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Members of {org.name}</CardTitle>
          <CardDescription>People with access to this organization.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {org.members.map((member) => (
              <li key={member.id} className="flex items-center gap-3 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{member.user.name}</div>
                  <div className="truncate text-muted-foreground">{member.user.email}</div>
                </div>
                {canManage && member.userId !== session.userId ? (
                  <>
                    <select
                      aria-label={`Role of ${member.user.email}`}
                      className={selectClass}
                      value={member.role}
                      onChange={(event) => {
                        const role = event.target.value
                        if (isRole(role)) void changeRole(member.id, role)
                      }}
                    >
                      {roles.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                    <Button variant="outline" size="sm" onClick={() => remove(member.id)}>
                      Remove
                    </Button>
                  </>
                ) : (
                  <span className="text-muted-foreground">{member.role}</span>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Invite a member</CardTitle>
            <CardDescription>
              Share the link with them. With the email extra they also get it by email.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={invite} className="flex items-end gap-2">
              <div className="flex-1 space-y-2">
                <Label htmlFor="invite-email">Email</Label>
                <Input id="invite-email" name="email" type="email" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-role">Role</Label>
                <select id="invite-role" name="role" className={selectClass}>
                  {inviteRoles.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit">Invite</Button>
            </form>
            {link === null ? null : (
              <div className="space-y-2">
                <Label htmlFor="invite-link">Invitation link</Label>
                <div className="flex gap-2">
                  <Input
                    id="invite-link"
                    readOnly
                    value={link}
                    onFocus={(e) => e.target.select()}
                  />
                  <Button variant="outline" onClick={() => copy(link)}>
                    Copy
                  </Button>
                </div>
              </div>
            )}
            {pending.length === 0 ? null : (
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Pending invitations</h3>
                <ul className="divide-y">
                  {pending.map((invitation) => (
                    <li key={invitation.id} className="flex items-center gap-2 py-2 text-sm">
                      <span className="flex-1 truncate">
                        {invitation.email}{" "}
                        <span className="text-muted-foreground">({invitation.role})</span>
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copy(inviteLink(invitation.id))}
                      >
                        Copy link
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => cancel(invitation.id)}>
                        Cancel
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
