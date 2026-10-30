import { createFileRoute, Link, Outlet } from "@tanstack/react-router"

import { PageShell } from "@/components/page-shell"
import { PageHeader } from "@/components/page-header"
import { tabLink } from "@/lib/row-style"

export const Route = createFileRoute("/app/settings")({ component: SettingsLayout })

/** Tabs of the settings area; `efforge add` extras link their own pages here. */
const tabs = [
  { to: "/app/settings", label: "Profile" },
  { to: "/app/settings/organization", label: "Organization" },
  { to: "/app/settings/members", label: "Members" },
  { to: "/app/settings/ai", label: "AI" },
  { to: "/app/settings/branding", label: "Branding" },
] as const

function SettingsLayout() {
  return (
    <PageShell width="readable">
      <PageHeader title="Settings" description="Your profile and organization preferences." />
      <nav
        aria-label="Settings"
        className="scroll-edges -mx-2.5 flex gap-1 overflow-x-auto overflow-y-hidden border-b"
      >
        {tabs.map(({ to, label }) => (
          <Link key={to} to={to} activeOptions={{ exact: true }} className={tabLink}>
            {label}
          </Link>
        ))}
      </nav>
      <Outlet />
    </PageShell>
  )
}
