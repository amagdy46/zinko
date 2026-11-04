import { Link, useRouter } from "@tanstack/react-router"
import { Check, ChevronsUpDown, Plus } from "lucide-react"
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

/** A page of another organization's data does not exist here, so only the section is kept. */
const sectionOf = (pathname: string) => {
  if (pathname.startsWith("/app/sites")) return "/app/sites"
  if (pathname.startsWith("/app/settings/ai")) return "/app/settings/ai"
  if (pathname.startsWith("/app/settings/members")) return "/app/settings/members"
  if (pathname.startsWith("/app/settings/branding")) return "/app/settings/branding"
  if (pathname.startsWith("/app/settings")) return "/app/settings"
  return "/app"
}

/** The first crumb of the top bar: lists the user's organizations; picking one makes it the active organization. Below `sm` it shrinks to the initial, so the site keeps the room. */
export function OrgSwitcher({
  organizations,
  activeId,
}: {
  organizations: ReadonlyArray<Organization>
  activeId: string | null
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
    await router.navigate({ to: sectionOf(router.state.location.pathname) })
    setSwitching(false)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-8 max-w-56 justify-start gap-1.5 px-1 sm:px-2"
          disabled={switching}
          aria-label="Switch organization"
        >
          <Avatar className="size-6 rounded-md sm:hidden">
            <AvatarFallback className="text-xs">
              {active?.name.charAt(0).toUpperCase() ?? "?"}
            </AvatarFallback>
          </Avatar>
          <span className="hidden truncate text-left font-medium sm:inline">
            {active?.name ?? "Select organization"}
          </span>
          <ChevronsUpDown className="hidden size-3.5 shrink-0 text-muted-foreground sm:block" />
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
          <Link to="/onboarding">
            <Plus className="size-4" />
            Create organization
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
