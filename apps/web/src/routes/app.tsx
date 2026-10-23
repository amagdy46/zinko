import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router"
import { Menu, Search, Settings, Users } from "lucide-react"
import { useState } from "react"
import { CommandPalette } from "@/components/command-palette"
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

function SidebarContent({ onNavigate, onFind }: { onNavigate?: () => void; onFind: () => void }) {
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
      <button
        type="button"
        data-find-return
        onClick={onFind}
        className="flex h-8 items-center gap-2 rounded-md border bg-background px-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-ring focus-visible:outline-2"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Find…</span>
        <kbd className="hidden font-sans text-xs md:inline">⌘K</kbd>
      </button>
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
  const { session, organizations } = Route.useRouteContext()
  const [menuOpen, setMenuOpen] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  return (
    <div className="grid min-h-dvh grid-cols-1 md:grid-cols-[14rem_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-4 border-r bg-sidebar p-3 md:flex">
        <SidebarContent onFind={() => setFindOpen(true)} />
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="flex items-center gap-2 border-b bg-sidebar px-4 py-2 md:hidden">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open menu" data-find-return>
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="w-72 gap-4 bg-sidebar p-3 sm:max-w-72 [&>button.absolute]:top-2 [&>button.absolute]:right-2 [&>button.absolute]:flex [&>button.absolute]:size-8 [&>button.absolute]:items-center [&>button.absolute]:justify-center"
            >
              <SheetTitle className="sr-only">Workspace menu</SheetTitle>
              <SheetDescription className="sr-only">
                Switch organization, navigate, or manage your account.
              </SheetDescription>
              <SidebarContent
                onNavigate={() => setMenuOpen(false)}
                onFind={() => {
                  setMenuOpen(false)
                  setFindOpen(true)
                }}
              />
            </SheetContent>
          </Sheet>
          <LogoMark className="size-5" />
        </header>
        <main className="min-w-0 flex-1 p-4 md:p-6">
          <Outlet />
        </main>
        <CommandPalette
          key={session.activeOrganizationId}
          open={findOpen}
          onOpenChange={setFindOpen}
          organizations={organizations}
          activeId={session.activeOrganizationId}
        />
      </div>
    </div>
  )
}
