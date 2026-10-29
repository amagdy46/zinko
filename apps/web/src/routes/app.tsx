import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useRouter,
  useRouterState,
} from "@tanstack/react-router"
import { Menu, Search, Settings, Users } from "lucide-react"
import { useEffect, useState } from "react"
import { CommandPalette } from "@/components/command-palette"
import { LogoMark } from "@/components/logo"
import { NotFound } from "@/components/not-found"
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
import { safeRedirect } from "@/lib/redirect"
import { getAppState } from "@/server/session"

export const Route = createFileRoute("/app")({
  beforeLoad: async ({ location }) => {
    const state = await getAppState()
    if (state === null)
      throw redirect({ to: "/sign-in", search: { redirect: safeRedirect(location.href) } })
    // first sign-in: nothing to work in yet, so create an organization
    if (state.organizations.length === 0) throw redirect({ to: "/onboarding" })
    return state
  },
  component: AppShell,
  notFoundComponent: () => <NotFound />,
})

const nav = [
  {
    to: "/app/clients",
    label: "Clients",
    icon: Users,
    sections: ["clients", "sites", "audits", "sample-report"],
  },
  { to: "/app/settings", label: "Settings", icon: Settings, sections: ["settings"] },
] as const

function SidebarContent({ onNavigate, onFind }: { onNavigate?: () => void; onFind: () => void }) {
  const { session, organizations } = Route.useRouteContext()
  const section = useRouterState({ select: (state) => state.location.pathname.split("/")[2] })
  return (
    <>
      <Link
        to="/"
        onClick={onNavigate}
        className="flex h-9 items-center gap-2 rounded-md px-2 font-semibold focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
        aria-label="Zinko home"
      >
        <LogoMark className="size-6" />
        Zinko
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
        className="flex h-9 items-center gap-2 rounded-md border bg-card px-2 text-sm text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Find…</span>
        <kbd className="hidden font-sans text-xs md:inline">⌘K</kbd>
      </button>
      <nav aria-label="Workspace" className="flex flex-1 flex-col gap-0.5">
        {nav.map(({ to, label, icon: Icon, sections }) => (
          <Link
            key={to}
            to={to}
            onClick={onNavigate}
            aria-current={sections.some((name) => name === section) ? "page" : undefined}
            className="relative flex h-9 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground transition-colors duration-150 last:mt-auto before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none aria-[current=page]:bg-accent aria-[current=page]:font-medium aria-[current=page]:text-accent-foreground aria-[current=page]:before:bg-primary"
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
  const router = useRouter()
  // A navigation replaces the page without a reload, so move focus to the new page's heading. It is
  // a target for screen readers and the next Tab, not a control, so it takes no ring.
  useEffect(
    () =>
      router.subscribe("onResolved", ({ pathChanged }) => {
        if (!pathChanged) return
        const main = document.getElementById("main")
        const target = main?.querySelector<HTMLElement>("h1") ?? main
        if (target === null || target === undefined) return
        target.tabIndex = -1
        target.focus({ preventScroll: true })
      }),
    [router],
  )
  return (
    <div className="grid min-h-dvh grid-cols-1 md:grid-cols-[14rem_minmax(0,1fr)] print:block print:min-h-0">
      <a
        href="#main"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-2 focus-visible:left-2 focus-visible:z-50 focus-visible:flex focus-visible:h-8 focus-visible:items-center print:hidden focus-visible:rounded-md focus-visible:border focus-visible:bg-background focus-visible:px-3 focus-visible:text-sm focus-visible:font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
      >
        Skip to content
      </a>
      <aside
        aria-label="Sidebar"
        className="sticky top-0 hidden h-dvh flex-col gap-4 border-r bg-sidebar p-3 md:flex print:hidden"
      >
        <SidebarContent onFind={() => setFindOpen(true)} />
      </aside>
      <div className="flex min-w-0 flex-col print:block">
        <header className="flex items-center gap-2 border-b bg-sidebar px-4 py-2 md:hidden print:hidden">
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
          <span className="flex items-center gap-2 font-semibold">
            <LogoMark className="size-6" />
            Zinko
          </span>
        </header>
        <main
          id="main"
          tabIndex={-1}
          className="min-w-0 flex-1 p-4 [&_h1:focus-visible]:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset md:p-6 print:p-0"
        >
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
