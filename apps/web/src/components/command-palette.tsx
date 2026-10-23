import { useRouter } from "@tanstack/react-router"
import { Building2, Globe, Plus, Users } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { authClient } from "@/lib/auth-client"
import { createClient, searchTargets } from "@/server/clients"

interface Organization {
  readonly id: string
  readonly name: string
}

/** ⌘K / Ctrl+K palette: jump to a client or site, create a client, switch organization. */
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
  const [search, setSearch] = useState("")
  const [naming, setNaming] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const [targets, setTargets] = useState<Awaited<ReturnType<typeof searchTargets>> | null>(null)

  useEffect(() => {
    let current = true
    if (open)
      searchTargets().then(
        (found) => {
          if (current) setTargets(found)
        },
        () => {
          if (current) toast.error("Could not load clients and sites.")
        },
      )
    return () => {
      current = false
    }
  }, [open])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        onOpenChange(!open)
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [open, onOpenChange])

  function change(next: boolean) {
    onOpenChange(next)
    if (!next) {
      setSearch("")
      setTargets(null)
      setNaming(false)
    }
  }

  function go(run: () => Promise<unknown>) {
    change(false)
    void run()
  }

  async function create(name: string) {
    const result = await createClient({ data: { name } })
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    change(false)
    await router.navigate({ to: "/app/clients/$clientId", params: { clientId: result.value.id } })
  }

  async function switchOrganization(organizationId: string) {
    const { error } = await authClient.organization.setActive({ organizationId })
    if (error) {
      toast.error(error.message ?? "Could not switch organization. Try again.")
      return
    }
    await router.invalidate()
    await router.navigate({ to: "/app/clients" })
  }

  const clients = targets?.clients ?? []
  const sites = targets?.sites ?? []
  const text = search.trim()

  return (
    <CommandDialog
      open={open}
      onOpenChange={change}
      title="Find"
      description="Go to a client or site, create a client, or switch organization."
      commandProps={{ shouldFilter: !naming }}
    >
      <CommandInput
        ref={input}
        value={search}
        onValueChange={setSearch}
        placeholder={naming ? "Name the new client…" : "Find a client, site or action…"}
      />
      <CommandList>
        {naming ? (
          <CommandGroup heading="New client">
            <CommandItem
              value="create-client"
              disabled={text === ""}
              onSelect={() => void create(text)}
            >
              <Plus />
              {text === "" ? "Type a name, then press Enter" : `Create client "${text}"`}
            </CommandItem>
          </CommandGroup>
        ) : (
          <>
            <CommandEmpty>{targets === null ? "Loading…" : "Nothing found."}</CommandEmpty>
            <CommandGroup heading="Actions">
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
              <CommandItem
                value="All clients"
                onSelect={() => go(() => router.navigate({ to: "/app/clients" }))}
              >
                <Users />
                All clients
              </CommandItem>
            </CommandGroup>
            {clients.length > 0 ? (
              <CommandGroup heading="Clients">
                {clients.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={`client ${c.name} ${c.id}`}
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
                    <span className="truncate">{c.name}</span>
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
