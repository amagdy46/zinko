import { useRouter } from "@tanstack/react-router"
import {
  Building2,
  ClipboardList,
  Globe,
  Moon,
  Plus,
  Settings,
  Sparkles,
  Users,
} from "lucide-react"
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react"
import { toast } from "sonner"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { useTheme } from "@/components/theme-provider"
import { authClient } from "@/lib/auth-client"
import { ScoreFigure } from "@/components/score-figure"
import { StatusBadge, StatusMark, toBadgeStatus } from "@/components/status-badge"
import { count, shortDateTime, useTimeZone } from "@/lib/format"
import { searchTargets } from "@/server/sites"

interface Organization {
  readonly id: string
  readonly name: string
}

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g
const fold = (text: string) => text.toLowerCase().replace(/['\u2019]/g, "")

/**
 * Every word of the query (split like the item, so "example.com" or "/drift/" work) has to start a word (rank 2) or sit inside one (rank 1) of the item; the
 * rank is the weakest word's. cmdk's own fuzzy match lets "store" reach Settings through its keywords,
 * and ids are not searched.
 */
const matchRank = (value: string, search: string, keywords?: string[]) => {
  const words = fold(search)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
  if (words.length === 0) return 1
  const haystack = fold([value, ...(keywords ?? [])].join(" ").replace(UUID, " ")).split(
    /[^\p{L}\p{N}]+/u,
  )
  let rank = 2
  for (const word of words) {
    if (haystack.some((token) => token.startsWith(word))) continue
    if (haystack.some((token) => token.includes(word))) rank = 1
    else return 0
  }
  return rank
}

/** ⌘K / Ctrl+K palette: jump to a site, recent audit or settings page, start an audit, toggle the theme, switch organization. */
export function CommandPalette({
  open,
  onOpenChange,
  organizations,
  activeId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  organizations: ReadonlyArray<Organization>
  activeId: string | null
}) {
  const router = useRouter()
  const timeZone = useTimeZone()
  const { setTheme } = useTheme()
  const [search, setSearch] = useState("")
  const [switching, setSwitching] = useState(false)
  const [targets, setTargets] = useState<Awaited<ReturnType<typeof searchTargets>> | null>(null)
  const loaded = useRef(false)
  const opener = useRef<HTMLElement | null>(null)
  const openedOn = useRef("")
  const query = search.trim()

  useEffect(() => {
    let current = true
    const timer = window.setTimeout(
      () => {
        if (!open) return
        searchTargets({ data: { query } }).then(
          (found) => {
            if (!current) return
            loaded.current = true
            setTargets(found)
          },
          () => {
            if (current) toast.error("Could not load search results.")
          },
        )
      },
      loaded.current ? 200 : 0,
    )
    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [open, query])

  // A layout effect, so it runs before the dialog takes focus, however the palette was opened.
  useLayoutEffect(() => {
    if (!open) return
    openedOn.current = router.state.location.pathname
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
  }, [open, router])

  function change(next: boolean) {
    if (next === open || (next && switching)) return
    if (!next) {
      setSearch("")
      setTargets(null)
      loaded.current = false
    }
    onOpenChange(next)
  }

  const toggle = useEffectEvent(() => change(!open))

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Chrome autofill dispatches keydown events with no `key`, whatever the DOM typing says.
      if (
        typeof event.key === "string" &&
        event.key.toLowerCase() === "k" &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault()
        toggle()
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [])

  function restoreFocus(event: Event) {
    event.preventDefault()
    // the page changed under the palette: focus already moved to the new page's heading
    if (router.state.location.pathname !== openedOn.current) return
    const back = opener.current?.isConnected
      ? opener.current
      : [...document.querySelectorAll<HTMLElement>("[data-find-return]")].find(
          (el) => el.offsetParent !== null,
        )
    back?.focus()
  }

  function go(run: () => Promise<unknown>) {
    change(false)
    void run()
  }

  async function switchOrganization(organizationId: string) {
    setSwitching(true)
    try {
      const { error } = await authClient.organization.setActive({ organizationId })
      if (error) {
        toast.error(error.message ?? "Could not switch organization. Try again.")
        return
      }
      await router.invalidate()
      await router.navigate({ to: "/app" })
    } finally {
      setSwitching(false)
    }
  }

  const audits = targets?.audits ?? []
  const sites = targets?.sites ?? []
  const text = search.trim()
  const actions = (
    <CommandGroup heading="Actions">
      <CommandItem
        value="New site"
        keywords={["create", "add"]}
        onSelect={() => go(() => router.navigate({ to: "/app/sites", search: { add: true } }))}
      >
        <Plus />
        New site
      </CommandItem>
      <CommandItem
        value="All sites"
        onSelect={() => go(() => router.navigate({ to: "/app/sites" }))}
      >
        <Globe />
        All sites
      </CommandItem>
      <CommandItem
        value="Settings"
        keywords={["profile", "account"]}
        onSelect={() => go(() => router.navigate({ to: "/app/settings" }))}
      >
        <Settings />
        Settings
      </CommandItem>
      <CommandItem
        value="AI settings"
        keywords={["model", "key", "explanations", "provider"]}
        onSelect={() => go(() => router.navigate({ to: "/app/settings/ai" }))}
      >
        <Sparkles />
        AI settings
      </CommandItem>
      <CommandItem
        value="Members"
        keywords={["team", "invite", "people"]}
        onSelect={() => go(() => router.navigate({ to: "/app/settings/members" }))}
      >
        <Users />
        Members
      </CommandItem>
      <CommandItem
        value="Toggle theme"
        keywords={["dark", "light", "mode"]}
        onSelect={() => {
          change(false)
          setTheme(document.documentElement.classList.contains("dark") ? "light" : "dark")
        }}
      >
        <Moon />
        Toggle theme
      </CommandItem>
    </CommandGroup>
  )

  return (
    <CommandDialog
      open={open}
      onOpenChange={change}
      title="Find"
      description={`Go to a site, audit or settings page, start an audit, or switch organization.`}
      onCloseAutoFocus={restoreFocus}
      commandProps={{
        filter: matchRank,
        label: "Find sites and actions",
      }}
    >
      <CommandInput value={search} onValueChange={setSearch} placeholder="Find a site or action…" />
      <CommandList>
        <>
          <CommandEmpty>{targets === null ? "Loading…" : "Nothing found."}</CommandEmpty>
          {text === "" ? actions : null}
          {audits.length > 0 ? (
            <CommandGroup heading="Recent audits">
              {audits.map((a) => (
                <CommandItem
                  key={a.id}
                  value={`audit of ${a.siteName} ${a.startPath ?? ""} ${a.id}`}
                  onSelect={() =>
                    go(() =>
                      router.navigate({
                        to: "/app/audits/$auditId",
                        params: { auditId: a.id },
                      }),
                    )
                  }
                >
                  <ClipboardList />
                  <span className="min-w-0">
                    <span className="block truncate">Audit of {a.siteName}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {shortDateTime(a.createdAt, timeZone)}· {a.startPath ?? "/"} ·{" "}
                      {count(a.pages, "page")}
                    </span>
                  </span>
                  <span className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    <StatusBadge status={toBadgeStatus(a.status)} className="max-sm:hidden" />
                    <StatusMark status={toBadgeStatus(a.status)} className="sm:hidden" />
                    {a.score === null || a.coverage === null ? null : (
                      <ScoreFigure score={a.score} coverage={a.coverage} size="inline" />
                    )}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {sites.length > 0 ? (
            <CommandGroup heading="Sites">
              {sites.map((s) => (
                <CommandItem
                  key={s.id}
                  value={`site ${s.name} ${s.host} ${s.id}`}
                  onSelect={() =>
                    go(() =>
                      router.navigate({ to: "/app/sites/$siteId", params: { siteId: s.id } }),
                    )
                  }
                >
                  <Globe />
                  <span className="min-w-0">
                    <span className="block truncate">{s.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{s.host}</span>
                  </span>
                </CommandItem>
              ))}
              {targets?.sitesCapped ? <CapNote noun="sites" /> : null}
            </CommandGroup>
          ) : null}
          {sites.length > 0 && text !== "" ? (
            <CommandGroup heading="New audit">
              {sites.map((s) => (
                <CommandItem
                  key={s.id}
                  value={`new audit for ${s.name} ${s.host} ${s.id}`}
                  onSelect={() =>
                    go(() =>
                      router.navigate({
                        to: "/app/sites/$siteId/audits/new",
                        params: { siteId: s.id },
                      }),
                    )
                  }
                >
                  <Plus />
                  <span className="min-w-0">
                    <span className="block truncate">New audit for {s.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{s.host}</span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {text === "" ? null : actions}
          {organizations.length > 1 ? (
            <CommandGroup heading="Switch organization">
              {organizations
                .filter((org) => org.id !== activeId)
                .map((org) => (
                  <CommandItem
                    key={org.id}
                    value={`organization ${org.name} ${org.id}`}
                    onSelect={() => go(() => switchOrganization(org.id))}
                  >
                    <Building2 />
                    <span className="truncate">{org.name}</span>
                  </CommandItem>
                ))}
            </CommandGroup>
          ) : null}
        </>
      </CommandList>
    </CommandDialog>
  )
}

function CapNote({ noun }: { noun: string }) {
  return (
    <p className="px-2 py-1.5 text-xs text-muted-foreground">
      Showing first 20 {noun}. Keep typing to narrow the list.
    </p>
  )
}
