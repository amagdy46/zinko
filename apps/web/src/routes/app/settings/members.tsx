import { createFileRoute } from "@tanstack/react-router"
import { type FormEvent, type MouseEvent, useRef, useState } from "react"
import { toast } from "sonner"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { authClient } from "@/lib/auth-client"
import { formField } from "@/lib/form"

export const Route = createFileRoute("/app/settings/members")({ component: Members })

const roles = ["member", "admin", "owner"] as const
const roleLabels = { member: "Member", admin: "Admin", owner: "Owner" }
const inviteLink = (id: string) => `${window.location.origin}/accept-invite/${id}`
const isRole = (value: string): value is (typeof roles)[number] =>
  roles.some((role) => role === value)

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success("Link copied")
  } catch {
    toast.error("Could not copy the link. Open the invitation dialog to copy it manually.")
  }
}

function Members() {
  const { session } = Route.useRouteContext()
  const { data: org, isPending, error: loadError, refetch } = authClient.useActiveOrganization()
  const [open, setOpen] = useState(false)
  const [link, setLink] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<{
    kind: "remove" | "cancel"
    id: string
    who: string
  } | null>(null)
  const opener = useRef<HTMLElement | null>(null)

  function ask(event: MouseEvent<HTMLElement>, next: NonNullable<typeof confirming>) {
    opener.current = event.currentTarget
    setConfirming(next)
  }

  if (isPending)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading members…
      </p>
    )
  if (loadError)
    return (
      <p role="alert" className="text-sm text-destructive">
        Could not load members. Reload the page to try again.
      </p>
    )
  if (!org)
    return (
      <p className="text-sm text-muted-foreground">Select an organization to view its members.</p>
    )

  const me = org.members.find((member) => member.userId === session.userId)
  const canManage = me?.role === "owner" || me?.role === "admin"
  const pending = org.invitations.filter((invitation) => invitation.status === "pending")

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setBusy("invite")
    const { data: created, error } = await authClient.organization.inviteMember({
      email: formField(data, "email"),
      role: data.get("role") === "admin" ? "admin" : "member",
      organizationId: org?.id,
    })
    setBusy(null)
    if (error || !created) {
      toast.error(error?.message ?? "Could not create the invitation")
      return
    }
    setLink(inviteLink(created.id))
    toast.success("Invitation created")
    await refetch()
  }

  async function changeRole(memberId: string, role: (typeof roles)[number]) {
    setBusy(memberId)
    const { error } = await authClient.organization.updateMemberRole({
      memberId,
      role,
      organizationId: org?.id,
    })
    if (error) toast.error(error.message ?? "Could not change the role")
    else await refetch()
    setBusy(null)
  }

  async function remove(memberId: string) {
    setBusy(memberId)
    const { error } = await authClient.organization.removeMember({
      memberIdOrEmail: memberId,
      organizationId: org?.id,
    })
    if (error) toast.error(error.message ?? "Could not remove the member")
    else {
      toast.success("Member removed")
      await refetch()
    }
    setBusy(null)
  }

  async function cancel(invitationId: string) {
    setBusy(invitationId)
    const { error } = await authClient.organization.cancelInvitation({ invitationId })
    if (error) toast.error(error.message ?? "Could not cancel the invitation")
    else {
      toast.success("Invitation cancelled")
      await refetch()
    }
    setBusy(null)
  }

  return (
    <section className="space-y-4" aria-labelledby="members-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 id="members-title" className="text-lg font-semibold wrap-break-word">
            Members of {org.name}
          </h2>
          <p className="text-sm text-muted-foreground">People with access to this organization.</p>
        </div>
        {canManage ? (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => setLink(null)}>Invite member</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Invite member</DialogTitle>
                <DialogDescription>
                  Invite someone to {org.name}. They must sign in with the invited email address.
                </DialogDescription>
              </DialogHeader>
              {link === null ? (
                <form onSubmit={invite} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="invite-email">Email</Label>
                    <Input
                      id="invite-email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="invite-role">Role</Label>
                    <Select name="role" defaultValue="member">
                      <SelectTrigger id="invite-role" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="member">Member</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <p>
                      <span className="font-medium text-foreground">Member:</span> Works with
                      clients, sites and audits.
                    </p>
                    <p>
                      <span className="font-medium text-foreground">Admin:</span> Also manages
                      members and AI settings.
                    </p>
                    <p>
                      <span className="font-medium text-foreground">Owner:</span> Has full
                      organization control. Assign this role after joining.
                    </p>
                  </div>
                  <Button type="submit" disabled={busy !== null}>
                    {busy === "invite" ? "Inviting…" : "Send invitation"}
                  </Button>
                </form>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="invite-link">Invitation link</Label>
                  <Input
                    id="invite-link"
                    readOnly
                    value={link}
                    onFocus={(event) => event.target.select()}
                  />
                  <Button variant="outline" onClick={() => copy(link)}>
                    Copy link
                  </Button>
                </div>
              )}
            </DialogContent>
          </Dialog>
        ) : null}
      </div>
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-2/5">Member</TableHead>
            <TableHead>Role</TableHead>
            <TableHead className="hidden sm:table-cell">Status</TableHead>
            {canManage ? (
              <TableHead className="w-20 sm:w-44">
                <span className="sr-only">Actions</span>
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {org.members.map((member) => (
            <TableRow key={member.id}>
              <TableCell className="whitespace-normal">
                <div className="flex items-center gap-2">
                  <Avatar className="hidden sm:flex">
                    <AvatarFallback>{member.user.name.slice(0, 1).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="wrap-break-word font-medium">
                      {member.user.name}
                      {member.userId === session.userId ? " (you)" : ""}
                    </div>
                    <div className="break-all text-xs text-muted-foreground">
                      {member.user.email}
                    </div>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                {canManage && member.userId !== session.userId ? (
                  <Select
                    value={member.role}
                    disabled={busy !== null}
                    onValueChange={(value) => {
                      if (isRole(value)) void changeRole(member.id, value)
                    }}
                  >
                    <SelectTrigger
                      size="sm"
                      className="w-full sm:w-28"
                      aria-label={`Role of ${member.user.email}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((role) => (
                        <SelectItem key={role} value={role}>
                          {roleLabels[role]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Badge variant="secondary">
                    {isRole(member.role) ? roleLabels[member.role] : member.role}
                  </Badge>
                )}
              </TableCell>
              <TableCell className="hidden text-muted-foreground sm:table-cell">Joined</TableCell>
              {canManage ? (
                <TableCell className="text-right">
                  {member.userId !== session.userId ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy !== null}
                      onClick={(event) =>
                        ask(event, { kind: "remove", id: member.id, who: member.user.email })
                      }
                    >
                      Remove
                    </Button>
                  ) : null}
                </TableCell>
              ) : null}
            </TableRow>
          ))}
          {canManage
            ? pending.map((invitation) => (
                <TableRow key={invitation.id}>
                  <TableCell className="whitespace-normal">
                    <div className="break-all text-sm">{invitation.email}</div>
                    <Badge variant="outline" className="mt-1 sm:hidden">
                      Pending
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">
                    {invitation.role !== null && isRole(invitation.role)
                      ? roleLabels[invitation.role]
                      : invitation.role}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Badge variant="outline">Pending</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-end gap-1 sm:flex-row sm:justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setLink(inviteLink(invitation.id))
                          setOpen(true)
                          void copy(inviteLink(invitation.id))
                        }}
                      >
                        Copy link
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy !== null}
                        onClick={(event) =>
                          ask(event, { kind: "cancel", id: invitation.id, who: invitation.email })
                        }
                      >
                        Cancel
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            : null}
        </TableBody>
      </Table>
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setConfirming(null)
        }}
        label={confirming?.kind === "cancel" ? "Cancel invitation" : "Remove"}
        variant="destructive"
        title={
          confirming?.kind === "cancel"
            ? `Cancel the invitation for ${confirming.who}?`
            : `Remove ${confirming?.who ?? "this member"}?`
        }
        description={
          confirming?.kind === "cancel"
            ? "The invitation link stops working."
            : "They lose access to this organization's clients and audits."
        }
        returnFocus={opener}
        onConfirm={async () => {
          if (confirming === null) return
          if (confirming.kind === "cancel") await cancel(confirming.id)
          else await remove(confirming.id)
        }}
      />
    </section>
  )
}
