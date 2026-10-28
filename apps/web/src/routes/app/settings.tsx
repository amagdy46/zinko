import { createFileRoute, Link, Outlet } from "@tanstack/react-router"

import { PageContainer } from "@/components/page-container"
import { PageHeader } from "@/components/page-header"

export const Route = createFileRoute("/app/settings")({ component: SettingsLayout })

/** Tabs of the settings area; `efforge add` extras link their own pages here. */
const tabs = [
  { to: "/app/settings", label: "Profile" },
  { to: "/app/settings/members", label: "Members" },
  { to: "/app/settings/ai", label: "AI" },
] as const

function SettingsLayout() {
  return (
    <PageContainer>
      <PageHeader title="Settings" description="Your profile and organization preferences." />
      <nav aria-label="Settings" className="flex gap-1 border-b">
        {tabs.map(({ to, label }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: true }}
            className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground [&.active]:border-primary [&.active]:text-foreground"
          >
            {label}
          </Link>
        ))}
      </nav>
      <Outlet />
    </PageContainer>
  )
}
