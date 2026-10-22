import { createFileRoute, getRouteApi, useNavigate } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { HitSummary, Pre, RawRequest, Section } from "@/components/evidence"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { runPage, scenarioLabel } from "@/lib/audit-labels"
import { cn } from "@/lib/utils"
import { getAudit } from "@/server/audits"
import { getHitDetail, listHitFilters, listTimeline } from "@/server/hits"

const auditRoute = getRouteApi("/app/audits/$auditId")

type Search = {
  source?: Source
  runId?: string
  vendor?: string
  event?: string
  scenario?: string
  /** With `hit`: the run of the hit to open, whatever page of the timeline it falls on. */
  run?: string
  /** `<requestId>:<batchIndex>` of the hit to open. */
  hit?: string
}

const SOURCES = ["network", "dataLayer"] as const
type Source = (typeof SOURCES)[number]

const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : undefined)

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
  validateSearch: (search: Record<string, unknown>): Search => ({
    source: SOURCES.find((s) => s === search.source),
    runId: text(search.runId),
    vendor: text(search.vendor),
    event: text(search.event),
    scenario: text(search.scenario),
    run: text(search.run),
    hit: text(search.hit),
  }),
  // opening a hit changes no filter, so it does not reload the timeline
  loaderDeps: ({ search }) => ({
    source: search.source,
    runId: search.runId,
    vendor: search.vendor,
    event: search.event,
    scenario: search.scenario,
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

type Item = Awaited<ReturnType<typeof listTimeline>>["items"][number]
type HitItem = Extract<Item, { kind: "hit" }>

const selectClass =
  "h-8 rounded-md border bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"

const itemKey = (item: Item) => (item.kind === "hit" ? hitKey(item) : `p:${item.runId}:${item.seq}`)

const hitKey = (hit: HitRef) => `h:${hit.runId}:${hit.requestId}:${hit.batchIndex}`

const preview = (item: Item) => {
  if (item.kind === "push") return JSON.stringify(item.value)
  return Object.entries(item.params)
    .slice(0, 4)
    .map(([name, value]) => `${name}=${value}`)
    .join(" ")
}

function HitsExplorer() {
  const { audit, runs } = auditRoute.useLoaderData()
  const { timeline, filters } = Route.useLoaderData()
  const { run, hit, ...search } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const scenarios = [...new Set(runs.map((r) => r.scenario))]

  const change = (key: keyof Search, value: string) =>
    void navigate({
      search: (prev) => ({
        ...prev,
        run: undefined,
        hit: undefined,
        [key]: value === "" ? undefined : value,
      }),
    })

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <FilterSelect
          label="Run"
          value={search.runId}
          all="All runs"
          onChange={(value) => change("runId", value)}
          options={runs.map((r) => ({
            value: r.id,
            label: `${runPage(r)} · ${scenarioLabel(r.scenario)} · ${r.viewport}`,
          }))}
        />
        <FilterSelect
          label="Scenario"
          value={search.scenario}
          all="All scenarios"
          onChange={(value) => change("scenario", value)}
          options={scenarios.map((s) => ({ value: s, label: scenarioLabel(s) }))}
        />
        <FilterSelect
          label="Source"
          value={search.source}
          all="All"
          onChange={(value) => change("source", value)}
          options={[
            { value: "network", label: "Network" },
            { value: "dataLayer", label: "dataLayer" },
          ]}
        />
        <FilterSelect
          label="Vendor"
          value={search.vendor}
          all="All vendors"
          onChange={(value) => change("vendor", value)}
          options={filters.vendors.map((v) => ({ value: v, label: v }))}
        />
        <FilterSelect
          label="Event"
          value={search.event}
          all="All events"
          onChange={(value) => change("event", value)}
          options={filters.events.map((e) => ({ value: e, label: e }))}
        />
      </div>
      <Timeline
        key={JSON.stringify({ search, run, hit })}
        auditId={audit.id}
        search={search}
        pinned={parseHit(run, hit)}
        first={timeline}
        runLabels={new Map(runs.map((r) => [r.id, r]))}
      />
    </div>
  )
}

function FilterSelect({
  label,
  value,
  all,
  options,
  onChange,
}: {
  label: string
  value: string | undefined
  all: string
  options: ReadonlyArray<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  const id = `filter-${label.toLowerCase()}`
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <select
        id={id}
        className={cn(selectClass, "max-w-64")}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{all}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

type RunInfo = Awaited<ReturnType<typeof getAudit>>["runs"][number]

function Timeline({
  auditId,
  search,
  pinned,
  first,
  runLabels,
}: {
  auditId: string
  search: Omit<Search, "run" | "hit">
  pinned: HitRef | undefined
  first: Awaited<ReturnType<typeof listTimeline>>
  runLabels: ReadonlyMap<string, RunInfo>
}) {
  const [items, setItems] = useState(first.items)
  const [cursor, setCursor] = useState(first.nextCursor)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const shown = selected ?? (pinned && hitKey(pinned)) ?? null
  const active = items.find((item) => itemKey(item) === shown)
  // a hit opened from a link may be on a page that is not loaded
  const target =
    active ?? (selected === null && pinned ? { kind: "hit" as const, ...pinned } : undefined)

  async function more() {
    if (cursor === null) return
    setLoading(true)
    try {
      const page = await listTimeline({ data: { auditId, ...search, cursor } })
      setItems((prev) => [...prev, ...page.items])
      setCursor(page.nextCursor)
    } finally {
      setLoading(false)
    }
  }

  if (items.length === 0 && pinned === undefined)
    return <p className="text-sm text-muted-foreground">No hits match these filters.</p>

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="space-y-2">
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-max text-left font-mono text-xs" data-testid="timeline">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                {search.runId === undefined ? (
                  <th className="px-2 py-1.5 font-medium">Run</th>
                ) : null}
                <th className="px-2 py-1.5 font-medium">t</th>
                <th className="px-2 py-1.5 font-medium">Source</th>
                <th className="px-2 py-1.5 font-medium">Vendor</th>
                <th className="px-2 py-1.5 font-medium">Event</th>
                <th className="px-2 py-1.5 font-medium">Destination</th>
                <th className="px-2 py-1.5 font-medium">Key params</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const key = itemKey(item)
                return (
                  <tr
                    key={key}
                    data-testid="timeline-row"
                    data-kind={item.kind}
                    data-selected={key === shown}
                    onClick={() => setSelected(key)}
                    className={cn(
                      "cursor-pointer border-t align-top hover:bg-muted/50",
                      key === shown && "bg-accent",
                    )}
                  >
                    {search.runId === undefined ? (
                      <td className="px-2 py-1 whitespace-nowrap text-muted-foreground">
                        #{item.ordinal + 1}
                      </td>
                    ) : null}
                    <td className="px-2 py-1 whitespace-nowrap tabular-nums">{item.at} ms</td>
                    <td className="px-2 py-1 text-muted-foreground">
                      {item.kind === "push" ? "dataLayer" : "network"}
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap">
                      {item.kind === "hit" ? item.vendor : "-"}
                    </td>
                    <td className="px-2 py-1">
                      <button
                        type="button"
                        className="text-left font-medium outline-none focus-visible:underline"
                        onClick={() => setSelected(key)}
                      >
                        {item.kind === "hit" ? item.event : "push"}
                      </button>
                      {item.kind === "hit" ? <HitFlags hit={item} /> : null}
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap">
                      {item.kind === "hit" ? item.destinationId : "-"}
                    </td>
                    <td className="max-w-48 truncate px-2 py-1 text-muted-foreground">
                      {preview(item)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span data-testid="timeline-count">
            {items.length} {items.length === 1 ? "item" : "items"} loaded
          </span>
          {cursor === null ? null : (
            <Button variant="outline" size="sm" disabled={loading} onClick={() => void more()}>
              {loading ? "Loading" : "Load more"}
            </Button>
          )}
        </div>
      </div>
      <aside aria-label="Hit detail" className="sticky top-4 rounded-lg border bg-card p-3 text-sm">
        {target === undefined ? (
          <p className="text-muted-foreground">Select a hit or a push to see it in full.</p>
        ) : (
          <Detail auditId={auditId} item={target} run={runLabels.get(target.runId)} />
        )}
      </aside>
    </div>
  )
}

function HitFlags({ hit }: { hit: HitItem }) {
  return (
    <span className="ml-2 inline-flex gap-1 align-middle">
      {hit.afterConsentAction ? (
        <Badge variant="secondary" className="bg-warning/15 text-warning">
          after consent action
        </Badge>
      ) : null}
      {hit.blocked ? (
        <Badge variant="outline" className="text-muted-foreground">
          attempt
        </Badge>
      ) : null}
    </span>
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
          {runPage(run)} · {scenarioLabel(run.scenario)} · {run.viewport}
        </p>
      )}
      {item.kind === "push" ? (
        <>
          <h2 className="font-medium">dataLayer push at {item.at} ms</h2>
          <Pre>{JSON.stringify(item.value, null, 2)}</Pre>
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
    | { state: "failed" }
    | { state: "ready"; value: Awaited<ReturnType<typeof getHitDetail>> }
  >({ state: "loading" })

  useEffect(() => {
    let current = true
    getHitDetail({
      data: { auditId, runId: hit.runId, requestId: hit.requestId, batchIndex: hit.batchIndex },
    })
      .then((value) => current && setDetail({ state: "ready", value }))
      .catch(() => current && setDetail({ state: "failed" }))
    return () => {
      current = false
    }
  }, [auditId, hit.runId, hit.requestId, hit.batchIndex])

  return (
    <>
      <div aria-live="polite">
        {detail.state === "loading" ? <p className="text-muted-foreground">Loading</p> : null}
        {detail.state === "failed" ? (
          <p role="alert" className="text-destructive">
            This hit could not be loaded.
          </p>
        ) : null}
      </div>
      {detail.state === "ready" ? (
        <>
          <HitSummary hit={detail.value.hit} />
          <Section title="Raw request">
            <RawRequest request={detail.value.request} />
          </Section>
        </>
      ) : null}
    </>
  )
}
