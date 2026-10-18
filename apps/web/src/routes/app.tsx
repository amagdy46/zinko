import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router"
import { LayoutDashboard, Settings } from "lucide-react"
import { OrgSwitcher } from "@/components/org-switcher"
import { ThemeToggle } from "@/components/theme-toggle"
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
  { to: "/app/settings", label: "Settings", icon: Settings },
] as const

function AppShell() {
  const { session, organizations } = Route.useRouteContext()
  return (
    <div className="grid min-h-screen grid-cols-[14rem_1fr]">
      <aside className="flex flex-col gap-6 border-r bg-muted/40 p-4">
        <Link to="/" className="font-semibold">
          My app
        </Link>
        <OrgSwitcher organizations={organizations} activeId={session.activeOrganizationId} />
        <nav className="flex flex-col gap-1">
          {nav.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: to === "/app" }}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground [&.active]:bg-accent [&.active]:text-accent-foreground"
            >
              <Icon className="size-4" />
              {label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex flex-col">
        <header className="flex items-center justify-end gap-2 border-b px-6 py-3">
          <ThemeToggle />
          <UserMenu name={session.name} email={session.email} />
        </header>
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
