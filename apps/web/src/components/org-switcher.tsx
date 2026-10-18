import { Link, useRouter } from "@tanstack/react-router"
import { Check, ChevronsUpDown, Plus } from "lucide-react"
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
}: {
  organizations: ReadonlyArray<Organization>
  activeId: string | null
}) {
  const router = useRouter()
  const active = organizations.find((org) => org.id === activeId)

  async function select(organizationId: string) {
    await authClient.organization.setActive({ organizationId })
    await router.invalidate()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-between"
          aria-label="Switch organization"
        >
          <span className="truncate">{active?.name ?? "Select organization"}</span>
          <ChevronsUpDown className="size-4 opacity-50" />
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
