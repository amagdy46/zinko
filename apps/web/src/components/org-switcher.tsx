import { Link, useRouter } from "@tanstack/react-router"
import { Check, ChevronsUpDown, Plus, Users } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { authClient } from "@/lib/auth-client"

interface Organization {
  readonly id: string
  readonly name: string
}

/** Lists the user's organizations in the sidebar; picking one makes it the active organization. */
export function OrgSwitcher({
  organizations,
  activeId,
  onNavigate,
}: {
  organizations: ReadonlyArray<Organization>
  activeId: string | null
  onNavigate?: () => void
}) {
  const router = useRouter()
  const [switching, setSwitching] = useState(false)
  const active = organizations.find((org) => org.id === activeId)

  async function select(organizationId: string) {
    setSwitching(true)
    const { error } = await authClient.organization.setActive({ organizationId })
    if (error) {
      setSwitching(false)
      toast.error(error.message ?? "Could not switch organization. Try again.")
      return
    }
    await router.invalidate()
    await router.navigate({ to: "/app" })
    setSwitching(false)
    onNavigate?.()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-10 w-full justify-start gap-2 px-2"
          disabled={switching}
          aria-label="Switch organization"
        >
          <Avatar className="size-6">
            <AvatarFallback className="bg-muted text-xs">
              {active?.name.charAt(0).toUpperCase() ?? "?"}
            </AvatarFallback>
          </Avatar>
          <span className="flex-1 truncate text-left">{active?.name ?? "Select organization"}</span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        {organizations.map((org) => (
          <DropdownMenuItem key={org.id} onSelect={() => select(org.id)}>
            <span className="flex-1 truncate">{org.name}</span>
            {org.id === activeId ? <Check className="size-4" /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/app/settings/members" onClick={onNavigate}>
            <Users className="size-4" />
            Members
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/onboarding" onClick={onNavigate}>
            <Plus className="size-4" />
            Create organization
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
