import { Link, useMatch, useRouterState } from "@tanstack/react-router"
import { Search } from "lucide-react"
import { LogoMark } from "@/components/logo"
import { OrgSwitcher } from "@/components/org-switcher"
import { SiteSwitcher } from "@/components/site-switcher"
import { UserMenu } from "@/components/user-menu"
import { useFindShortcut } from "@/lib/find-shortcut"
import { cn } from "@/lib/utils"

const Slash = ({ className }: { className?: string }) => (
  <li aria-hidden className={cn("shrink-0 text-sm text-muted-foreground select-none", className)}>
    /
  </li>
)

/** Where this page is, read from the routes already loaded, so no page has to report it. */
function useTrail() {
  const sitePage = useMatch({ from: "/app/sites/$siteId", shouldThrow: false })
  const newAudit = useMatch({ from: "/app/sites/$siteId_/audits/new", shouldThrow: false })
  const audit = useMatch({ from: "/app/audits/$auditId", shouldThrow: false })
  const sites = useMatch({ from: "/app/sites/", shouldThrow: false })
  const pathname = useRouterState({ select: (state) => state.location.pathname })

  if (pathname.startsWith("/app/settings")) return { switcher: false, tail: "Settings" } as const
  if (pathname.startsWith("/app/design-system"))
    return { switcher: false, tail: "Design system" } as const

  const site = sitePage?.loaderData?.site ?? newAudit?.loaderData?.site ?? audit?.loaderData?.site
  const tailOf = () => {
    if (newAudit !== undefined) return "New audit"
    if (audit !== undefined) return audit.loaderData?.audit.kind === "narrow" ? "Re-check" : "Audit"
    if (sites?.search.archived === true) return "Archived"
    return pathname.startsWith("/app/sample-report") ? "Sample report" : null
  }
  return { switcher: true, site: site ?? null, tail: tailOf() } as const
}

/** The app's only navigation: the breadcrumb is the way around, Find and the account sit at the right. */
export function TopBar({
  session,
  organizations,
  onFind,
}: {
  session: { name: string; email: string; activeOrganizationId: string | null }
  organizations: ReadonlyArray<{ readonly id: string; readonly name: string }>
  onFind: () => void
}) {
  const trail = useTrail()
  const shortcut = useFindShortcut()
  return (
    <header className="flex h-14 items-center justify-between gap-2 border-b px-4 md:px-6 print:hidden">
      <nav aria-label="Breadcrumb" className="min-w-0">
        <ol className="flex items-center gap-0.5">
          <li className="mr-1 shrink-0">
            <Link
              to="/app"
              activeOptions={{ exact: true }}
              aria-label="Zinko, all sites"
              className="flex size-8 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
            >
              <LogoMark className="size-6" />
            </Link>
          </li>
          <li className="min-w-0 shrink-0 sm:shrink">
            <OrgSwitcher organizations={organizations} activeId={session.activeOrganizationId} />
          </li>
          <Slash />
          {trail.switcher ? (
            <li className="min-w-0">
              <SiteSwitcher
                key={session.activeOrganizationId}
                site={trail.site}
                current={trail.tail === null}
              />
            </li>
          ) : null}
          {trail.tail === null ? null : (
            <>
              {trail.switcher ? <Slash className="hidden md:block" /> : null}
              <li
                aria-current="page"
                className={
                  trail.switcher
                    ? "hidden shrink-0 px-2 text-sm text-muted-foreground md:block"
                    : "shrink-0 px-2 text-sm font-medium"
                }
              >
                {trail.tail}
              </li>
            </>
          )}
        </ol>
      </nav>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          data-find-return
          onClick={onFind}
          aria-label="Find"
          className="flex size-8 items-center justify-center gap-2 rounded-md border border-border-subtle text-sm text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none md:w-48 md:justify-start md:px-2"
        >
          <Search className="size-4 shrink-0" />
          <span className="hidden flex-1 text-left md:inline">Find</span>
          <kbd className="hidden font-sans text-xs md:inline">{shortcut}</kbd>
        </button>
        <UserMenu name={session.name} email={session.email} />
      </div>
    </header>
  )
}
