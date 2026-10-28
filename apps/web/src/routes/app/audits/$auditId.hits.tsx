import { createFileRoute, getRouteApi, useNavigate } from "@tanstack/react-router"
import { ChevronDown, ChevronLeft, ChevronRight, ListFilter, Search, X } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import {
  ConsentTokens,
  JsonView,
  KeyValueTable,
  LoadFailure,
  loadFailure,
  RequestView,
  Section,
} from "@/components/evidence"
import { EmptyState } from "@/components/empty-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { scenarioLabel } from "@/lib/audit-labels"
import { searchText, searchValues } from "@/lib/hits-filter"
import { hasClickIds, runPageLabel } from "@/lib/page-label"
import { sharePending } from "@/lib/share-pending"
import { consentWords, vendorName } from "@/lib/tag-matrix"
import { selectableRow } from "@/lib/row-style"
import { cn } from "@/lib/utils"
import { getAudit } from "@/server/audits"
import { getHitDetail as fetchHitDetail, listHitFilters, listTimeline } from "@/server/hits"

const getHitDetail = sharePending(fetchHitDetail)

const auditRoute = getRouteApi("/app/audits/$auditId")

/** One value (the old links) or several. */
type ListParam = string | ReadonlyArray<string>

type HitsSearch = {
  source?: Source
  runId?: ListParam
  vendor?: ListParam
  event?: ListParam
  destinationId?: ListParam
  scenario?: ListParam
  timing?: Timing
  q?: string
  /** With `hit`: the run of the hit to open, whatever page of the timeline it falls on. */
  run?: string
  /** `<requestId>:<batchIndex>` of the hit to open. */
  hit?: string
}

const SOURCES = ["network", "dataLayer"] as const
type Source = (typeof SOURCES)[number]

const TIMINGS = ["before", "after"] as const
type Timing = (typeof TIMINGS)[number]

const nonEmpty = (values: string[]) => (values.length === 0 ? undefined : values)

const asList = (value: ListParam | undefined): string[] => {
  if (value === undefined) return []
  return typeof value === "string" ? [value] : [...value]
}

type DraftKey = "vendor" | "event" | "destinationId" | "scenario" | "runId" | "source" | "timing"

type HitRef = { runId: string; requestId: string; batchIndex: number }

/** Request ids may hold colons, so the batch index is what follows the last one. */
const parseHit = (run: string | undefined, hit: string | undefined): HitRef | undefined => {
  if (run === undefined || hit === undefined) return undefined
  const colon = hit.lastIndexOf(":")
  const batchIndex = Number(hit.slice(colon + 1))
  if (colon < 1 || !Number.isInteger(batchIndex) || batchIndex < 0) return undefined
  return { runId: run, requestId: hit.slice(0, colon), batchIndex }
}

export const Route = createFileRoute("/app/audits/$auditId/hits")({
  validateSearch: (search: Record<string, unknown>): HitsSearch => ({
    source: SOURCES.find((s) => s === search.source),
    runId: searchValues(search.runId),
    vendor: searchValues(search.vendor),
    event: searchValues(search.event),
    destinationId: searchValues(search.destinationId),
    scenario: searchValues(search.scenario),
    timing: TIMINGS.find((t) => t === search.timing),
    q: searchText(search.q),
    run: searchText(search.run),
    hit: searchText(search.hit),
  }),
  // opening a hit changes no filter, so it does not reload the timeline
  loaderDeps: ({ search }) => ({
    source: search.source,
    runId: asList(search.runId),
    vendor: asList(search.vendor),
    event: asList(search.event),
    destinationId: asList(search.destinationId),
    scenario: asList(search.scenario),
    timing: search.timing,
    q: search.q,
  }),
  loader: async ({ params, deps }) => {
    const [timeline, filters] = await Promise.all([
      listTimeline({ data: { auditId: params.auditId, ...deps } }),
      listHitFilters({ data: { auditId: params.auditId } }),
    ])
    return { timeline, filters }
  },
  notFoundComponent: () => <p className="text-sm text-muted-foreground">Audit not found.</p>,
  component: HitsExplorer,
})

type Timeline = Awaited<ReturnType<typeof listTimeline>>
type Item = Timeline["items"][number]
type HitItem = Extract<Item, { kind: "hit" }>
type PushItem = Extract<Item, { kind: "push" }>
type RunMeta = Timeline["runs"][number]
type RunInfo = Awaited<ReturnType<typeof getAudit>>["runs"][number]

const hitKey = (hit: HitRef) => `h:${hit.runId}:${hit.requestId}:${hit.batchIndex}`
const itemKey = (item: Item) => (item.kind === "hit" ? hitKey(item) : `p:${item.runId}:${item.seq}`)

const thousands = (n: number) => n.toLocaleString("en")

const isText = (value: unknown): value is string => typeof value === "string"

/** `value.event`, or the gtag command and its first argument ("consent default"). */
const pushName = (value: PushItem["value"]) => {
  if (Array.isArray(value)) {
    const words = value.slice(0, 2).filter(isText)
    return words.length === 0 ? "push" : words.join(" ")
  }
  if (typeof value === "object" && value !== null) {
    const event = Object.entries(value).find(([key]) => key === "event")?.[1]
    if (isText(event)) return event
  }
  return "push"
}

const preview = (item: Item) => {
  if (item.kind === "push") return JSON.stringify(item.value)
  return Object.entries(item.params)
    .slice(0, 4)
    .map(([name, value]) => `${name}=${value}`)
    .join(" ")
}

type Row =
  | { type: "divider"; key: string; run: RunMeta }
  | { type: "hit"; key: string; item: HitItem }
  | { type: "push"; key: string; items: PushItem[]; json: string }

/**
 * The table's rows from every loaded item. A run's consent divider is placed once: before its
 * first item at or after the action, or after its last item when none is later, which is known
 * once a later run appears or no page is left. Being derived from the whole list, a page
 * boundary can neither repeat nor drop it.
 */
const buildRows = (
  items: ReadonlyArray<Item>,
  runs: ReadonlyMap<string, RunMeta>,
  complete: boolean,
): Row[] => {
  const rows: Row[] = []
  const placed = new Set<string>()
  const place = (runId: string) => {
    const meta = runs.get(runId)
    if (typeof meta?.consentActionAt !== "number" || placed.has(runId)) return
    placed.add(runId)
    rows.push({ type: "divider", key: `d:${runId}`, run: meta })
  }
  let current: string | undefined
  for (const item of items) {
    if (current !== undefined && current !== item.runId) place(current)
    current = item.runId
    const action = runs.get(item.runId)?.consentActionAt
    if (typeof action === "number" && item.at >= action) place(item.runId)
    if (item.kind === "hit") {
      rows.push({ type: "hit", key: itemKey(item), item })
      continue
    }
    const json = JSON.stringify(item.value)
    const previous = rows.at(-1)
    if (
      previous?.type === "push" &&
      previous.json === json &&
      previous.items[0]?.runId === item.runId
    )
      previous.items.push(item)
    else rows.push({ type: "push", key: itemKey(item), items: [item], json })
  }
  if (complete && current !== undefined) place(current)
  return rows
}

const consentActionLabel = (run: RunMeta) => {
  const label = scenarioLabel(run.scenario)
  return run.consentOutcome === "not-applied"
    ? `Consent action: ${label} (not seen to take effect)`
    : `Consent action: ${label}`
}

const subscribe = (notify: () => void) => {
  const media = window.matchMedia("(min-width: 1024px)")
  media.addEventListener("change", notify)
  return () => media.removeEventListener("change", notify)
}
const useDesktop = () =>
  useSyncExternalStore(
    subscribe,
    () => window.matchMedia("(min-width: 1024px)").matches,
    () => true,
  )

type Choice = { value: string; label: string; count?: number }

/** A value from the URL that the audit has no rows for still shows, so it can be unchecked. */
const withSelected = (options: ReadonlyArray<Choice>, selected: ReadonlyArray<string>): Choice[] =>
  options.concat(
    selected
      .filter((s) => !options.some((o) => o.value === s))
      .map((s) => ({ value: s, label: s })),
  )

function OptionList({
  label,
  options,
  selected,
  onChange,
}: {
  label: string
  options: ReadonlyArray<Choice>
  selected: ReadonlyArray<string>
  onChange: (next: string[]) => void
}) {
  const [query, setQuery] = useState("")
  const shown = options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
  return (
    <div className="space-y-2">
      {options.length > 8 ? (
        <Input
          type="search"
          aria-label={`Find ${label.toLowerCase()}`}
          placeholder={`Find ${label.toLowerCase()}…`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-8"
        />
      ) : null}
      <div className="max-h-64 space-y-0.5 overflow-y-auto" role="group" aria-label={label}>
        {shown.length === 0 ? (
          <p className="px-1 py-1.5 text-xs text-muted-foreground">Nothing to choose.</p>
        ) : null}
        {shown.map((option) => {
          const checked = selected.includes(option.value)
          return (
            <label
              key={option.value}
              className="flex min-h-8 cursor-pointer items-center gap-2 rounded-sm px-1 text-sm hover:bg-accent"
            >
              <Checkbox
                checked={checked}
                onCheckedChange={() =>
                  onChange(
                    checked
                      ? selected.filter((v) => v !== option.value)
                      : [...selected, option.value],
                  )
                }
              />
              <span className="min-w-0 flex-1 break-words">{option.label}</span>
              {option.count === undefined ? null : (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {thousands(option.count)}
                </span>
              )}
            </label>
          )
        })}
      </div>
    </div>
  )
}

function FilterChip({
  label,
  plural,
  options,
  selected,
  onChange,
}: {
  label: string
  plural: string
  options: ReadonlyArray<Choice>
  selected: ReadonlyArray<string>
  onChange: (next: string[]) => void
}) {
  const names = selected.map((v) => options.find((o) => o.value === v)?.label ?? v)
  const summarized = names.length > 2
  const trigger = (
    <Button
      variant="outline"
      size="sm"
      className={cn(
        "max-w-64",
        selected.length === 0 ? "border-dashed text-muted-foreground" : "rounded-r-none",
      )}
    >
      <span className="truncate">
        {selected.length === 0
          ? `+ ${label}`
          : `${label}: ${summarized ? `${names.length} ${plural}` : names.join(", ")}`}
      </span>
    </Button>
  )
  return (
    <div className="inline-flex items-center">
      <Popover>
        {summarized ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>{trigger}</PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent className="max-w-80">
              <ul>
                {names.map((name) => (
                  <li key={name} className="break-words">
                    {name}
                  </li>
                ))}
              </ul>
            </TooltipContent>
          </Tooltip>
        ) : (
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        )}
        <PopoverContent align="start" className="w-64 p-2">
          <OptionList label={label} options={options} selected={selected} onChange={onChange} />
        </PopoverContent>
      </Popover>
      {selected.length === 0 ? null : (
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={`Clear ${label.toLowerCase()} filter`}
          className="h-8 rounded-l-none border-l-0"
          onClick={() => onChange([])}
        >
          <X aria-hidden="true" />
        </Button>
      )}
    </div>
  )
}

const SOURCE_CHOICES: ReadonlyArray<Choice> = [
  { value: "network", label: "Network requests" },
  { value: "dataLayer", label: "dataLayer pushes" },
]

const TIMING_CHOICES: ReadonlyArray<Choice> = [
  { value: "before", label: "Before the choice" },
  { value: "after", label: "After the choice" },
]

function HitsExplorer() {
  const { audit, runs } = auditRoute.useLoaderData()
  const { timeline, filters } = Route.useLoaderData()
  const { run, hit, ...search } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [typed, setTyped] = useState(search.q ?? "")
  // what this box pushed to the URL, so only a change from elsewhere replaces the text
  const pushedQ = useRef(new Set<string>())
  const filtersButton = useRef<HTMLButtonElement>(null)

  const apply = (patch: HitsSearch) =>
    void navigate({
      search: (prev) => ({ ...prev, run: undefined, hit: undefined, ...patch }),
      replace: true,
    })

  // Choices show at once and a quick second click builds on the first, though the URL (and the
  // list) only follow after the server answers; a draft lasts while the URL stays as it was.
  const urlKey = JSON.stringify([
    search.source,
    search.runId,
    search.vendor,
    search.event,
    search.destinationId,
    search.scenario,
    search.timing,
  ])
  const [draft, setDraft] = useState<{
    urlKey: string
    values: Partial<Record<DraftKey, string[]>>
  }>({ urlKey, values: {} })
  const drafted = draft.urlKey === urlKey ? draft.values : {}
  const choose = (key: DraftKey) => (next: string[]) => {
    const values = { ...drafted, [key]: next }
    setDraft({ urlKey, values })
    void navigate({
      search: (prev) => ({
        ...prev,
        run: undefined,
        hit: undefined,
        vendor: nonEmpty(values.vendor ?? asList(prev.vendor)),
        event: nonEmpty(values.event ?? asList(prev.event)),
        destinationId: nonEmpty(values.destinationId ?? asList(prev.destinationId)),
        scenario: nonEmpty(values.scenario ?? asList(prev.scenario)),
        runId: nonEmpty(values.runId ?? asList(prev.runId)),
        source:
          values.source === undefined
            ? prev.source
            : SOURCES.find((s) => values.source?.length === 1 && s === values.source[0]),
        timing:
          values.timing === undefined
            ? prev.timing
            : TIMINGS.find((t) => values.timing?.length === 1 && t === values.timing[0]),
      }),
      replace: true,
    })
  }

  useEffect(() => {
    const urlQ = search.q ?? ""
    if (pushedQ.current.delete(urlQ)) return
    setTyped(urlQ)
  }, [search.q, pushedQ])

  // the box is the source of truth while typing; the URL follows once the typing pauses
  useEffect(() => {
    const next = typed.trim() === "" ? undefined : typed.trim()
    if (next === search.q) return undefined
    const timer = setTimeout(() => {
      pushedQ.current.add(next ?? "")
      void navigate({
        search: (prev) => ({ ...prev, run: undefined, hit: undefined, q: next }),
        replace: true,
      })
    }, 300)
    return () => clearTimeout(timer)
  }, [typed, search.q, navigate, pushedQ])

  const vendor = drafted.vendor ?? asList(search.vendor)
  const events = drafted.event ?? asList(search.event)
  const destinations = drafted.destinationId ?? asList(search.destinationId)
  const scenario = drafted.scenario ?? asList(search.scenario)
  const runId = drafted.runId ?? asList(search.runId)
  const sources = drafted.source ?? (search.source === undefined ? [] : [search.source])
  const timings = drafted.timing ?? (search.timing === undefined ? [] : [search.timing])
  const groups = [
    {
      label: "Vendor",
      plural: "vendors",
      selected: vendor,
      onChange: choose("vendor"),
      options: withSelected(
        filters.vendors.map((v) => ({
          value: v.value,
          label: vendorName(v.value),
          count: v.count,
        })),
        vendor,
      ),
    },
    {
      label: "Event",
      plural: "events",
      selected: events,
      onChange: choose("event"),
      options: withSelected(
        filters.events.map((e) => ({ value: e.value, label: e.value, count: e.count })),
        events,
      ),
    },
    {
      label: "Destination",
      plural: "destinations",
      selected: destinations,
      onChange: choose("destinationId"),
      options: withSelected(
        filters.destinations.map((d) => ({ value: d.value, label: d.value, count: d.count })),
        destinations,
      ),
    },
    {
      label: "Scenario",
      plural: "scenarios",
      selected: scenario,
      onChange: choose("scenario"),
      options: withSelected(
        filters.scenarios.map((s) => ({
          value: s.value,
          label: scenarioLabel(s.value),
          count: s.count,
        })),
        scenario,
      ),
    },
    {
      label: "Source",
      plural: "sources",
      selected: sources,
      onChange: choose("source"),
      options: [...SOURCE_CHOICES],
    },
    {
      label: "Timing",
      plural: "timings",
      selected: timings,
      onChange: choose("timing"),
      options: [...TIMING_CHOICES],
    },
    {
      label: "Run",
      plural: "runs",
      selected: runId,
      onChange: choose("runId"),
      options: withSelected(
        runs.map((r) => ({
          value: r.id,
          label: `#${r.ordinal + 1} ${runPageLabel(r)} · ${scenarioLabel(r.scenario)} · ${r.viewport}`,
          count: r.hitCount,
        })),
        runId,
      ),
    },
  ]
  const active = groups.filter((g) => g.selected.length > 0).length
  const filtered = active > 0 || search.q !== undefined || typed !== ""
  const clear = () => {
    setTyped("")
    setDraft({ urlKey, values: {} })
    pushedQ.current.add("")
    apply({
      source: undefined,
      runId: undefined,
      vendor: undefined,
      event: undefined,
      destinationId: undefined,
      scenario: undefined,
      timing: undefined,
      q: undefined,
    })
  }
  const { counts } = timeline

  return (
    <TooltipProvider>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1 md:max-w-sm">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              aria-label="Filter hits"
              placeholder="Filter by event, id or parameter, e.g. gclid"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              className="h-8 pl-8"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            ref={filtersButton}
            className="md:hidden"
            onClick={() => setFiltersOpen(true)}
          >
            <ListFilter aria-hidden="true" />
            {active > 0 ? `Filters (${active})` : "Filters"}
          </Button>
          <div className="hidden flex-wrap items-center gap-2 md:flex">
            {groups.map((g) => (
              <FilterChip key={g.label} {...g} />
            ))}
          </div>
          {filtered ? (
            <Button variant="ghost" size="sm" onClick={clear}>
              Clear filters
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground tabular-nums" data-testid="timeline-counts">
          {[
            search.source === "dataLayer"
              ? null
              : `${thousands(counts.hits.matched)} of ${thousands(counts.hits.total)} hits`,
            search.source === "network"
              ? null
              : `${thousands(counts.pushes.matched)} of ${thousands(counts.pushes.total)} pushes`,
          ]
            .filter((part) => part !== null)
            .join(" · ")}
        </p>
        <Timeline
          key={JSON.stringify({ search, run, hit })}
          auditId={audit.id}
          singleRun={runId.length === 1}
          pinned={parseHit(run, hit)}
          first={timeline}
          filterData={{ ...search, runId, vendor, event: events, scenario }}
          runLabels={new Map(runs.map((r) => [r.id, r]))}
        />
        <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
          <SheetContent
            side="bottom"
            className="max-h-[85svh] overflow-y-auto"
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              filtersButton.current?.focus()
            }}
          >
            <SheetHeader>
              <SheetTitle>Filters</SheetTitle>
              <SheetDescription>Narrow the hits and pushes in the list.</SheetDescription>
            </SheetHeader>
            <div className="space-y-4 px-4">
              {groups.map((g) => (
                <section key={g.label} className="space-y-1">
                  <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    {g.label}
                  </h3>
                  <OptionList
                    label={g.label}
                    options={g.options}
                    selected={g.selected}
                    onChange={g.onChange}
                  />
                </section>
              ))}
            </div>
            <SheetFooter className="flex-row">
              <Button variant="outline" disabled={!filtered} onClick={clear}>
                Clear filters
              </Button>
              <Button onClick={() => setFiltersOpen(false)}>Show results</Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>
    </TooltipProvider>
  )
}

function Timeline({
  auditId,
  singleRun,
  pinned,
  first,
  filterData,
  runLabels,
}: {
  auditId: string
  singleRun: boolean
  pinned: HitRef | undefined
  first: Timeline
  filterData: Omit<HitsSearch, "run" | "hit" | "runId" | "vendor" | "event" | "scenario"> & {
    runId: string[]
    vendor: string[]
    event: string[]
    scenario: string[]
  }
  runLabels: ReadonlyMap<string, RunInfo>
}) {
  const desktop = useDesktop()
  const [items, setItems] = useState(first.items)
  const [cursor, setCursor] = useState(first.nextCursor)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  // null: nothing chosen yet, so a linked hit shows; "": closed on purpose
  const [selected, setSelected] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const runs = useMemo(() => new Map(first.runs.map((r) => [r.id, r])), [first.runs])
  const rows = useMemo(() => buildRows(items, runs, cursor === null), [items, runs, cursor])
  // hits and dataLayer pushes, the two kinds the list interleaves, as the filters leave them
  const matched =
    (filterData.source === "dataLayer" ? 0 : first.counts.hits.matched) +
    (filterData.source === "network" ? 0 : first.counts.pushes.matched)
  const shown = selected ?? (pinned && hitKey(pinned)) ?? ""
  const lastShown = useRef(shown)
  useEffect(() => {
    if (shown !== "") lastShown.current = shown
  }, [shown])
  const activeIndex = items.findIndex((item) => itemKey(item) === shown)
  const active = items[activeIndex]
  // a hit opened from a link may be on a page that is not loaded
  const target =
    active ?? (selected === null && pinned ? { kind: "hit" as const, ...pinned } : undefined)

  async function more() {
    if (cursor === null) return
    setLoading(true)
    setFailed(false)
    try {
      const page = await listTimeline({ data: { auditId, ...filterData, cursor } })
      setItems((prev) => [...prev, ...page.items])
      setCursor(page.nextCursor)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  const step = (offset: number) => {
    const next = items[activeIndex + offset]
    if (next) setSelected(itemKey(next))
  }

  if (items.length === 0 && pinned === undefined)
    return (
      <EmptyState
        title="Nothing matches"
        description={
          first.counts.hits.total + first.counts.pushes.total === 0
            ? "This audit captured no hits and no dataLayer pushes."
            : "No hit or push matches these filters. Clear a filter or change the search."
        }
      />
    )

  const detail =
    target === undefined ? null : (
      <Detail auditId={auditId} item={target} run={runLabels.get(target.runId)} />
    )

  const paneOpen = desktop && detail !== null
  const pane =
    detail === null ? null : (
      <aside
        aria-label="Hit detail"
        tabIndex={0}
        className="sticky top-4 max-h-[calc(100svh-2rem)] overflow-y-auto rounded-lg border bg-card p-3 text-sm focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {detail}
      </aside>
    )

  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,1fr)] items-start gap-4",
        paneOpen && "lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]",
      )}
    >
      <div className="min-w-0 space-y-2">
        <p className="text-xs text-muted-foreground">
          Time: ms since the capture started. Status: the HTTP status, or Answered locally. Consent:
          Ads is ad_storage, Analytics is analytics_storage. Select a row to see it in full.
        </p>
        <div className="scroll-edges max-h-[70svh] overflow-auto rounded-lg border">
          <table
            className="group/timeline w-full text-left text-xs"
            data-testid="timeline"
            data-pane={paneOpen ? "open" : "closed"}
          >
            <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
              <tr className="h-7">
                {singleRun ? null : <th className="px-2 font-medium">Run</th>}
                <th className="hidden px-2 font-medium md:table-cell">Time</th>
                <th className="px-2 font-medium">Vendor</th>
                <th className="px-2 font-medium">Event</th>
                <th className={cn("hidden px-2 font-medium md:table-cell", paneHidden)}>Status</th>
                <th className={cn("hidden px-2 font-medium md:table-cell", paneHidden)}>Consent</th>
                <th className={cn("hidden px-2 font-medium md:table-cell", paneHidden)}>
                  Destination
                </th>
                <th
                  className={cn(
                    "hidden w-full px-2 font-medium whitespace-nowrap 2xl:table-cell",
                    paneHidden,
                  )}
                >
                  Key params
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                if (row.type === "divider")
                  return (
                    <tr
                      key={row.key}
                      data-testid="consent-divider"
                      className="h-7 border-t bg-muted/40"
                    >
                      <td colSpan={8} className="px-2 text-muted-foreground">
                        <span className="font-medium">
                          {singleRun ? "" : `Run #${row.run.ordinal + 1} · `}
                          {consentActionLabel(row.run)}
                        </span>
                        {row.run.consentActionAt === null
                          ? null
                          : ` at ${thousands(row.run.consentActionAt)} ms`}
                      </td>
                    </tr>
                  )
                if (row.type === "hit")
                  return (
                    <HitRow
                      key={row.key}
                      item={row.item}
                      run={runLabels.get(row.item.runId)}
                      singleRun={singleRun}
                      isSelected={row.key === shown}
                      onSelect={() => setSelected(row.key)}
                    />
                  )
                const [firstPush] = row.items
                const lastPush = row.items.at(-1)
                if (firstPush === undefined || lastPush === undefined) return null
                const grouped = row.items.length > 1
                const open = expanded.has(row.key)
                const out = [
                  <PushRow
                    key={row.key}
                    item={firstPush}
                    run={runLabels.get(firstPush.runId)}
                    singleRun={singleRun}
                    group={grouped ? { count: row.items.length, to: lastPush.at, open } : undefined}
                    isSelected={!grouped && row.key === shown}
                    onSelect={() => {
                      if (!grouped) return setSelected(row.key)
                      setExpanded((prev) => {
                        const next = new Set(prev)
                        if (open) next.delete(row.key)
                        else next.add(row.key)
                        return next
                      })
                    }}
                  />,
                ]
                if (grouped && open)
                  for (const push of row.items)
                    out.push(
                      <PushRow
                        key={`n:${itemKey(push)}`}
                        item={push}
                        run={runLabels.get(push.runId)}
                        singleRun={singleRun}
                        nested
                        isSelected={itemKey(push) === shown}
                        onSelect={() => setSelected(itemKey(push))}
                      />,
                    )
                return out
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span data-testid="timeline-count">
            {thousands(items.length)} of {thousands(matched)} items loaded
          </span>
          {cursor === null ? null : (
            <Button variant="outline" size="sm" disabled={loading} onClick={() => void more()}>
              {loading ? "Loading" : "Load more"}
            </Button>
          )}
          {failed ? (
            <span role="alert" className="text-destructive">
              The next page could not be loaded.
            </span>
          ) : null}
        </div>
      </div>
      {desktop ? (
        pane
      ) : (
        <Sheet
          open={target !== undefined}
          onOpenChange={(open) => {
            if (!open) setSelected("")
          }}
        >
          <SheetContent
            side="bottom"
            className="max-h-[90svh] overflow-y-auto"
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              const row = [...document.querySelectorAll<HTMLElement>("tr[data-row-key]")].find(
                (el) => el.dataset.rowKey === lastShown.current,
              )
              row?.querySelector("button")?.focus()
            }}
          >
            <SheetHeader className="pr-12">
              <SheetTitle>
                {target?.kind === "push" ? "dataLayer push" : "Hit"}
                {activeIndex >= 0 ? ` ${activeIndex + 1}/${items.length}` : ""}
              </SheetTitle>
              <SheetDescription className="sr-only">Detail of the selected item.</SheetDescription>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={activeIndex < 1}
                  onClick={() => step(-1)}
                >
                  <ChevronLeft aria-hidden="true" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={activeIndex < 0 || activeIndex >= items.length - 1}
                  onClick={() => step(1)}
                >
                  Next
                  <ChevronRight aria-hidden="true" />
                </Button>
              </div>
            </SheetHeader>
            <div className="px-4 pb-6">{detail}</div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  )
}

const cellBase = "px-2 py-0 whitespace-nowrap"

/** Status, consent, destination and key params make room for the detail pane; the pane repeats them. */
const paneHidden = "group-data-[pane=open]/timeline:hidden!"

function RunCell({
  ordinal,
  run,
  singleRun,
}: {
  ordinal: number
  run: RunInfo | undefined
  singleRun: boolean
}) {
  if (singleRun) return null
  return (
    <td className={cn(cellBase, "text-muted-foreground")}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="block max-w-36 truncate md:max-w-56">
            #{ordinal + 1}
            {run === undefined ? "" : ` ${runPageLabel(run)} · ${scenarioLabel(run.scenario)}`}
          </span>
        </TooltipTrigger>
        {run === undefined ? null : (
          <TooltipContent className="max-w-80 break-words">{runTitle(run)}</TooltipContent>
        )}
      </Tooltip>
    </td>
  )
}

const runTitle = (run: RunInfo) =>
  `${run.pageUrl} · ${scenarioLabel(run.scenario)} · ${run.viewport}`

function HitRow({
  item,
  run,
  singleRun,
  isSelected,
  onSelect,
}: {
  item: HitItem
  run: RunInfo | undefined
  singleRun: boolean
  isSelected: boolean
  onSelect: () => void
}) {
  return (
    <tr
      data-testid="timeline-row"
      data-kind="hit"
      data-row-key={itemKey(item)}
      data-selected={isSelected}
      onClick={onSelect}
      className={cn("h-8 border-t max-md:h-9", selectableRow)}
    >
      <RunCell ordinal={item.ordinal} run={run} singleRun={singleRun} />
      <td className={cn(cellBase, "hidden font-mono tabular-nums md:table-cell")}>
        {thousands(item.at)} ms
      </td>
      <td className={cellBase}>{vendorName(item.vendor)}</td>
      <td className="p-0 whitespace-nowrap">
        <button
          type="button"
          title={item.event}
          className="block h-8 max-w-40 truncate px-2 text-left font-mono leading-8 font-medium outline-none focus-visible:rounded-sm focus-visible:ring-[3px] focus-visible:ring-ring/50"
          onClick={onSelect}
        >
          {item.event}
        </button>
      </td>
      <td className={cn(cellBase, "hidden md:table-cell", paneHidden)}>
        {item.blocked ? (
          <span title="Answered locally, not sent to the vendor">Answered locally</span>
        ) : (
          <span className="tabular-nums">{item.status ?? "No status"}</span>
        )}
      </td>
      <td className={cn(cellBase, "hidden md:table-cell", paneHidden)}>
        <ConsentText consent={item.consent} />
      </td>
      <td className={cn(cellBase, "hidden font-mono md:table-cell", paneHidden)}>
        {item.destinationId}
      </td>
      <td
        title={preview(item)}
        className={cn(
          "hidden max-w-0 truncate px-2 py-0 font-mono text-muted-foreground 2xl:table-cell",
          paneHidden,
        )}
      >
        {preview(item)}
      </td>
    </tr>
  )
}

function ConsentText({ consent }: { consent: HitItem["consent"] }) {
  if (consent.adStorage === "unknown" && consent.analyticsStorage === "unknown")
    return <span className="text-muted-foreground">No signal</span>
  return <span>{consentWords(consent.adStorage, consent.analyticsStorage)}</span>
}

function PushRow({
  item,
  run,
  singleRun,
  group,
  nested = false,
  isSelected,
  onSelect,
}: {
  item: PushItem
  run: RunInfo | undefined
  singleRun: boolean
  group?: { count: number; to: number; open: boolean }
  nested?: boolean
  isSelected: boolean
  onSelect: () => void
}) {
  return (
    <tr
      data-testid="timeline-row"
      data-kind="push"
      data-row-key={itemKey(item)}
      data-selected={isSelected}
      onClick={onSelect}
      className={cn(
        "h-8 border-t text-muted-foreground max-md:h-9",
        selectableRow,
        isSelected && "text-foreground",
      )}
    >
      <RunCell ordinal={item.ordinal} run={run} singleRun={singleRun} />
      <td className={cn(cellBase, "hidden font-mono tabular-nums md:table-cell")}>
        {group ? `${thousands(item.at)}–${thousands(group.to)} ms` : `${thousands(item.at)} ms`}
      </td>
      <td className={cellBase}>dataLayer</td>
      <td className="p-0 whitespace-nowrap">
        <button
          type="button"
          aria-expanded={group?.open}
          className={cn(
            "inline-flex h-8 items-center gap-1 px-2 text-left font-mono outline-none focus-visible:rounded-sm focus-visible:ring-[3px] focus-visible:ring-ring/50",
            nested && "pl-5",
          )}
          onClick={(event) => {
            event.stopPropagation()
            onSelect()
          }}
        >
          {group ? (
            <ChevronDown
              aria-hidden="true"
              className={cn("size-3.5", !group.open && "-rotate-90")}
            />
          ) : null}
          {pushName(item.value)}
          {group ? <Badge variant="secondary">{group.count} pushes</Badge> : null}
        </button>
      </td>
      <td className={cn(cellBase, "hidden md:table-cell", paneHidden)}>-</td>
      <td className={cn(cellBase, "hidden md:table-cell", paneHidden)}>-</td>
      <td className={cn(cellBase, "hidden md:table-cell", paneHidden)}>-</td>
      <td
        title={preview(item)}
        className={cn("hidden max-w-0 truncate px-2 py-0 font-mono 2xl:table-cell", paneHidden)}
      >
        {preview(item)}
      </td>
    </tr>
  )
}

function Detail({
  auditId,
  item,
  run,
}: {
  auditId: string
  item: Item | (HitRef & { kind: "hit" })
  run: RunInfo | undefined
}) {
  return (
    <div className="space-y-3">
      {run === undefined ? null : (
        <p className="text-xs text-muted-foreground">
          <span title={run.pageUrl}>{runPageLabel(run)}</span>
          {hasClickIds(run.pageUrl) ? (
            <Badge variant="secondary" className="mx-1">
              + click IDs
            </Badge>
          ) : null}
          {" · "}
          {scenarioLabel(run.scenario)} · {run.viewport}
        </p>
      )}
      {item.kind === "push" ? (
        <>
          <div className="space-y-1">
            <h2 className="font-medium">{pushName(item.value)}</h2>
            <p className="text-xs text-muted-foreground">
              dataLayer push at {thousands(item.at)} ms
            </p>
          </div>
          <JsonView value={item.value} />
        </>
      ) : (
        <HitDetail key={hitKey(item)} auditId={auditId} hit={item} />
      )}
    </div>
  )
}

function HitDetail({ auditId, hit }: { auditId: string; hit: HitRef }) {
  const [detail, setDetail] = useState<
    | { state: "loading" }
    | { state: "failed"; gone: boolean }
    | { state: "ready"; value: Awaited<ReturnType<typeof getHitDetail>> }
  >({ state: "loading" })

  const load = useCallback(
    () =>
      getHitDetail({
        data: { auditId, runId: hit.runId, requestId: hit.requestId, batchIndex: hit.batchIndex },
      })
        .then((value) => setDetail({ state: "ready", value }))
        .catch((error: unknown) => setDetail({ state: "failed", ...loadFailure(error) })),
    [auditId, hit.runId, hit.requestId, hit.batchIndex],
  )

  useEffect(() => {
    void load()
  }, [load])

  return (
    <>
      <div aria-live="polite">
        {detail.state === "loading" ? <p className="text-muted-foreground">Loading</p> : null}
        {detail.state === "failed" ? (
          <LoadFailure
            what="This hit"
            gone={detail.gone}
            onRetry={() => {
              setDetail({ state: "loading" })
              void load()
            }}
          />
        ) : null}
      </div>
      {detail.state === "ready" ? (
        <HitFacts hit={detail.value.hit} request={detail.value.request} />
      ) : null}
    </>
  )
}

function HitFacts({
  hit,
  request,
}: {
  hit: Awaited<ReturnType<typeof getHitDetail>>["hit"]
  request: Awaited<ReturnType<typeof getHitDetail>>["request"]
}) {
  return (
    <>
      <div className="space-y-1">
        <h2 className="font-medium">
          {vendorName(hit.vendor)} · {hit.event}
        </h2>
        <p className="text-xs text-muted-foreground">
          {hit.destinationId} · {thousands(hit.at)} ms · {hit.host}
        </p>
        <p className="flex flex-wrap gap-1 text-xs">
          {hit.afterConsentAction ? (
            <Badge variant="outline">sent at or after the consent action</Badge>
          ) : null}
          {hit.blocked ? (
            <Badge variant="outline">answered locally, not sent to the vendor</Badge>
          ) : null}
          {!hit.blocked && hit.status !== null ? (
            <Badge variant="outline">status {hit.status}</Badge>
          ) : null}
        </p>
      </div>
      <Section title="Consent">
        <ConsentTokens consent={hit.consent} />
      </Section>
      <Section title="Ids">
        <KeyValueTable rows={Object.entries(hit.ids)} empty="No ids." label="Ids" />
      </Section>
      <Section title="Parameters">
        <KeyValueTable
          rows={Object.entries(hit.params)}
          empty="No parameters."
          label="Parameters"
        />
      </Section>
      <Section title="Request">
        <RequestView request={request} />
      </Section>
    </>
  )
}
