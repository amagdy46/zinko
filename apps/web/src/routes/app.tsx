import { createFileRoute, Outlet, redirect, useRouter } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { CommandPalette } from "@/components/command-palette"
import { NotFound } from "@/components/not-found"
import { TopBar } from "@/components/top-bar"
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

function AppShell() {
  const { session, organizations } = Route.useRouteContext()
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
    <div className="flex min-h-dvh flex-col print:block print:min-h-0">
      <a
        href="#main"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-2 focus-visible:left-2 focus-visible:z-50 focus-visible:flex focus-visible:h-8 focus-visible:items-center print:hidden focus-visible:rounded-md focus-visible:border focus-visible:bg-background focus-visible:px-3 focus-visible:text-sm focus-visible:font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
      >
        Skip to content
      </a>
      <TopBar session={session} organizations={organizations} onFind={() => setFindOpen(true)} />
      <main
        id="main"
        tabIndex={-1}
        className="min-w-0 flex-1 [&_h1:focus-visible]:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
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
  )
}
