import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router"
import { Menu, Settings, Users } from "lucide-react"
import { useState } from "react"
import { LogoMark } from "@/components/logo"
import { OrgSwitcher } from "@/components/org-switcher"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { UserMenu } from "@/components/user-menu"
import { getAppState } from "@/server/session"

export const Route = createFileRoute("/app")({
  beforeLoad: async () => {
    const state = await getAppState()
    if (state === null) throw redirect({ to: "/sign-in" })
    // first sign-in: nothing to work in yet, so create an organization
    if (state.organizations.length === 0) throw redirect({ to: "/onboarding" })
    return state
  },
  component: AppShell,
})

const nav = [
  { to: "/app/clients", label: "Clients", icon: Users },
  { to: "/app/settings", label: "Settings", icon: Settings },
] as const

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { session, organizations } = Route.useRouteContext()
  return (
    <>
      <Link
        to="/"
        onClick={onNavigate}
        className="flex size-8 items-center justify-center rounded-sm focus-visible:outline-ring focus-visible:outline-2"
        aria-label="Zinko home"
      >
        <LogoMark className="size-5" />
      </Link>
      <OrgSwitcher
        organizations={organizations}
        activeId={session.activeOrganizationId}
        onNavigate={onNavigate}
      />
      <nav aria-label="Workspace" className="flex flex-1 flex-col gap-0.5">
        {nav.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            onClick={onNavigate}
            className="last:mt-auto flex h-8 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-ring focus-visible:outline-2 [&.active]:bg-accent [&.active]:font-medium [&.active]:text-accent-foreground"
          >
            <Icon className="size-4" />
            {label}
          </Link>
        ))}
      </nav>
      <UserMenu name={session.name} email={session.email} />
    </>
  )
}

function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <div className="grid min-h-dvh grid-cols-1 md:grid-cols-[14rem_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-4 border-r bg-sidebar p-3 md:flex">
        <SidebarContent />
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="flex items-center gap-2 border-b bg-sidebar px-4 py-2 md:hidden">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open menu">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="w-72 gap-4 bg-sidebar p-3 sm:max-w-72 [&>button]:top-2 [&>button]:right-2 [&>button]:flex [&>button]:size-8 [&>button]:items-center [&>button]:justify-center"
            >
              <SheetTitle className="sr-only">Workspace menu</SheetTitle>
              <SheetDescription className="sr-only">
                Switch organization, navigate, or manage your account.
              </SheetDescription>
              <SidebarContent onNavigate={() => setMenuOpen(false)} />
            </SheetContent>
          </Sheet>
          <LogoMark className="size-5" />
        </header>
        <main className="min-w-0 flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
