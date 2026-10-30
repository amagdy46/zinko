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
import { useEffect, useEffectEvent, useRef, useState } from "react"
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
import { StatusBadge, toBadgeStatus } from "@/components/status-badge"
import { count, shortDateTime, useTimeZone } from "@/lib/format"
import { createClient, searchTargets } from "@/server/clients"

interface Organization {
  readonly id: string
  readonly name: string
}

/** ⌘K / Ctrl+K palette: jump to a site (and a client when the organization groups by client), recent audit or settings page, start an audit, create a client, toggle the theme, switch organization. */
export function CommandPalette({
  open,
  onOpenChange,
  organizations,
  activeId,
  groupByClient,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  organizations: ReadonlyArray<Organization>
  activeId: string | null
  groupByClient: boolean
}) {
  const router = useRouter()
  const timeZone = useTimeZone()
  const { setTheme } = useTheme()
  const [search, setSearch] = useState("")
  const [naming, setNaming] = useState(false)
  const [creating, setCreating] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [targets, setTargets] = useState<Awaited<ReturnType<typeof searchTargets>> | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const loaded = useRef(false)
  const opener = useRef<HTMLElement | null>(null)
  const openedOn = useRef("")
  const query = naming ? "" : search.trim()

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

  function change(next: boolean) {
    if (next === open || (next && switching)) return
    if (next) {
      openedOn.current = router.state.location.pathname
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    } else {
      setSearch("")
      setTargets(null)
      loaded.current = false
      setNaming(false)
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

  async function create(name: string) {
    if (creating) return
    setCreating(true)
    try {
      const result = await createClient({ data: { name } })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      change(false)
      await router.navigate({ to: "/app/clients/$clientId", params: { clientId: result.value.id } })
    } finally {
      setCreating(false)
    }
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
  const clients = groupByClient ? (targets?.clients ?? []) : []
  const sites = targets?.sites ?? []
  const text = search.trim()
  let createLabel = `Create client "${text}"`
  if (text === "") createLabel = "Type a name, then press Enter"
  else if (creating) createLabel = "Creating…"

  let placeholder = groupByClient ? "Find a client, site or action…" : "Find a site or action…"
  if (naming) placeholder = "Name the new client…"

  return (
    <CommandDialog
      open={open}
      onOpenChange={change}
      title="Find"
      description={`Go to a ${groupByClient ? "client, " : ""}site, audit or settings page, start an audit, or switch organization.`}
      onCloseAutoFocus={restoreFocus}
      commandProps={{
        shouldFilter: !naming,
        label: groupByClient ? "Find clients, sites and actions" : "Find sites and actions",
      }}
    >
      <CommandInput
        ref={input}
        value={search}
        onValueChange={setSearch}
        placeholder={placeholder}
      />
      <CommandList>
        {naming ? (
          <CommandGroup heading="New client">
            <CommandItem
              value="create-client"
              disabled={text === "" || creating}
              onSelect={() => void create(text)}
            >
              <Plus />
              {createLabel}
            </CommandItem>
          </CommandGroup>
        ) : (
          <>
            <CommandEmpty>{targets === null ? "Loading…" : "Nothing found."}</CommandEmpty>
            <CommandGroup heading="Actions">
              <CommandItem
                value="New site"
                keywords={["create", "add"]}
                onSelect={() =>
                  go(() => router.navigate({ to: "/app/sites", search: { add: true } }))
                }
              >
                <Plus />
                New site
              </CommandItem>
              {groupByClient ? (
                <CommandItem
                  value="New client"
                  keywords={["create", "add"]}
                  onSelect={() => {
                    setSearch("")
                    setNaming(true)
                    input.current?.focus()
                  }}
                >
                  <Plus />
                  New client
                </CommandItem>
              ) : null}
              <CommandItem
                value="All sites"
                onSelect={() => go(() => router.navigate({ to: "/app/sites" }))}
              >
                <Globe />
                All sites
              </CommandItem>
              {groupByClient ? (
                <CommandItem
                  value="All clients"
                  onSelect={() => go(() => router.navigate({ to: "/app/clients" }))}
                >
                  <Users />
                  All clients
                </CommandItem>
              ) : null}
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
                    <span className="flex min-w-0 items-baseline gap-1">
                      <span className="truncate">
                        Audit of {a.siteName}
                        {a.startPath === null ? "" : ` ${a.startPath}`}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        · {count(a.pages, "page")}
                      </span>
                    </span>
                    <span className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                      <span className="hidden tabular-nums sm:inline">
                        {shortDateTime(a.createdAt, timeZone)}
                      </span>
                      <StatusBadge status={toBadgeStatus(a.status)} />
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
                    <span className="truncate">{s.name}</span>
                    <span className="ml-auto truncate text-xs text-muted-foreground">{s.host}</span>
                  </CommandItem>
                ))}
                {targets?.sitesCapped ? <CapNote noun="sites" /> : null}
              </CommandGroup>
            ) : null}
            {clients.length > 0 ? (
              <CommandGroup heading="Clients">
                {clients.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={`client ${c.name} ${c.distinguisher ?? ""} ${c.id}`}
                    onSelect={() =>
                      go(() =>
                        router.navigate({
                          to: "/app/clients/$clientId",
                          params: { clientId: c.id },
                        }),
                      )
                    }
                  >
                    <Users />
                    <span className="truncate">
                      {c.name}
                      {c.distinguisher === null ? null : (
                        <span className="text-muted-foreground"> · {c.distinguisher}</span>
                      )}
                    </span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {count(c.siteCount, "site")}
                    </span>
                  </CommandItem>
                ))}
                {targets?.clientsCapped ? <CapNote noun="clients" /> : null}
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
                    <span className="truncate">New audit for {s.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
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
        )}
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
