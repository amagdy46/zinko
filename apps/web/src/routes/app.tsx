import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router"
import { LayoutDashboard, Menu, Settings, Users } from "lucide-react"
import { useState } from "react"
import { Brand } from "@/components/logo"
import { OrgSwitcher } from "@/components/org-switcher"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
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
  { to: "/app", label: "Dashboard", icon: LayoutDashboard },
  { to: "/app/clients", label: "Clients", icon: Users },
  { to: "/app/settings", label: "Settings", icon: Settings },
] as const

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { session, organizations } = Route.useRouteContext()
  return (
    <>
      <Link to="/" onClick={onNavigate}>
        <Brand />
      </Link>
      <OrgSwitcher organizations={organizations} activeId={session.activeOrganizationId} />
      <nav className="flex flex-col gap-1">
        {nav.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            onClick={onNavigate}
            activeOptions={{ exact: to === "/app" }}
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground [&.active]:bg-accent [&.active]:text-accent-foreground"
          >
            <Icon className="size-4" />
            {label}
          </Link>
        ))}
      </nav>
    </>
  )
}

function AppShell() {
  const { session } = Route.useRouteContext()
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-[14rem_minmax(0,1fr)]">
      <aside className="hidden flex-col gap-6 border-r bg-muted/40 p-4 md:flex">
        <SidebarContent />
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="flex items-center justify-between gap-2 border-b px-4 py-3 md:justify-end md:px-6">
          <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
                <Menu />
              </Button>
            </DialogTrigger>
            <DialogContent className="top-0 left-0 h-full max-w-72 translate-x-0 translate-y-0 content-start gap-6 rounded-none border-0 border-r sm:max-w-72">
              <DialogTitle className="sr-only">Menu</DialogTitle>
              <DialogDescription className="sr-only">Navigate the app</DialogDescription>
              <SidebarContent onNavigate={() => setMenuOpen(false)} />
            </DialogContent>
          </Dialog>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <UserMenu name={session.name} email={session.email} />
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
