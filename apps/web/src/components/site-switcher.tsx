import { Link, useNavigate } from "@tanstack/react-router"
import { ChevronsUpDown, Globe, Plus } from "lucide-react"
import { useRef, useState } from "react"
import { ScoreFigure } from "@/components/score-figure"
import { StatusGlyph } from "@/components/status-glyph"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import { listSites } from "@/server/sites"

type Sites = Awaited<ReturnType<typeof listSites>>

/** Every typed word must appear in the name or the address. The item's value is its id, which is not searched. */
const matches = (_value: string, search: string, keywords?: ReadonlyArray<string>) => {
  const text = (keywords ?? []).join(" ").toLowerCase()
  return search
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => text.includes(word))
    ? 1
    : 0
}

function SiteState({ site }: { site: Sites[number] }) {
  if (site.running > 0)
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        <StatusGlyph meaning="running" />
        Running
      </span>
    )
  if (site.latest === null)
    return <span className="shrink-0 text-xs text-muted-foreground">Not audited</span>
  if (site.latest.score === null)
    return <span className="shrink-0 text-xs text-muted-foreground">Not scored</span>
  return (
    <ScoreFigure
      size="inline"
      className="shrink-0"
      score={site.latest.score}
      coverage={site.latest.scoreCoverage}
    />
  )
}

function SiteOptions({
  sites,
  failed,
  currentId,
  onSelect,
}: {
  sites: Sites | null
  failed: boolean
  currentId: string | undefined
  onSelect: (siteId: string) => void
}) {
  if (failed)
    return (
      <p className="px-3 py-6 text-center text-sm text-muted-foreground" role="alert">
        Could not load your sites. Close this and try again.
      </p>
    )
  if (sites === null)
    return (
      <div className="space-y-1 p-1" role="status" aria-label="Loading sites">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-12 w-full" />
        ))}
      </div>
    )
  return (
    <>
      <CommandEmpty>No site found.</CommandEmpty>
      <CommandGroup>
        {sites.map((item) => (
          <CommandItem
            key={item.id}
            value={item.id}
            keywords={[item.name, item.host]}
            aria-current={item.id === currentId ? "true" : undefined}
            onSelect={() => onSelect(item.id)}
            className="relative min-h-12 justify-between gap-4 px-3 before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full aria-[current=true]:before:bg-brand"
          >
            <span className="min-w-0">
              <span className="block truncate font-medium">{item.name}</span>
              <span className="block truncate font-mono text-xs text-muted-foreground">
                {item.host}
              </span>
            </span>
            <SiteState site={item} />
          </CommandItem>
        ))}
      </CommandGroup>
    </>
  )
}

/** The site crumb of the top bar: the name opens the site, the chevron switches to another one. */
export function SiteSwitcher({
  site,
  current,
}: {
  site: { id: string; name: string } | null
  current: boolean
}) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [sites, setSites] = useState<Sites | null>(null)
  const [failed, setFailed] = useState(false)
  const latest = useRef(0)

  // Asked again on every opening, so a site added or a score that changed since is right.
  const change = (next: boolean) => {
    setOpen(next)
    if (!next) return
    setFailed(false)
    latest.current += 1
    const request = latest.current
    listSites().then(
      (loaded) => {
        if (request === latest.current) setSites(loaded)
      },
      () => {
        if (request === latest.current) setFailed(true)
      },
    )
  }

  const go = (run: () => Promise<unknown>) => {
    setOpen(false)
    void run()
  }

  return (
    <span className="flex min-w-0 items-center">
      {site === null ? (
        <Link
          to="/app/sites"
          aria-current={current ? "page" : undefined}
          className={crumbLink}
          activeOptions={{ exact: true }}
        >
          Sites
        </Link>
      ) : (
        <Link
          to="/app/sites/$siteId"
          params={{ siteId: site.id }}
          activeOptions={{ exact: true }}
          aria-current={current ? "page" : undefined}
          className={crumbLink}
        >
          <span className="truncate">{site.name}</span>
        </Link>
      )}
      <Popover open={open} onOpenChange={change}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Switch site"
            className="size-8 shrink-0 text-muted-foreground"
          >
            <ChevronsUpDown className="size-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(28rem,calc(100vw-2rem))] p-0">
          <Command filter={matches}>
            <CommandInput placeholder="Find a site" aria-label="Find a site" />
            <CommandList className="max-h-[min(24rem,60dvh)]">
              <SiteOptions
                sites={sites}
                failed={failed}
                currentId={site?.id}
                onSelect={(siteId) =>
                  go(() => navigate({ to: "/app/sites/$siteId", params: { siteId } }))
                }
              />
              <CommandGroup forceMount className="sticky bottom-0 border-t bg-popover">
                <CommandItem
                  forceMount
                  value="All sites"
                  onSelect={() => go(() => navigate({ to: "/app/sites" }))}
                >
                  <Globe />
                  All sites
                </CommandItem>
                <CommandItem
                  forceMount
                  value="Add site"
                  onSelect={() => go(() => navigate({ to: "/app/sites", search: { add: true } }))}
                >
                  <Plus />
                  Add site
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </span>
  )
}

const crumbLink =
  "flex h-8 min-w-0 items-center rounded-md px-2 text-sm font-medium transition-colors duration-150 hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
