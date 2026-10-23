import type { CapturedRequest } from "@repo/capture-contract"
import { useState } from "react"
import { ChevronDown, Copy } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"

export function CopyButton({
  value,
  label = "Copy value",
  className,
}: {
  value: string
  label?: string
  className?: string
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      className={className}
      onClick={() => {
        navigator.clipboard.writeText(value).then(
          () => toast.success("Copied to clipboard"),
          () => toast.error("Could not copy. Select the value and copy it manually."),
        )
      }}
    >
      <Copy aria-hidden="true" />
    </Button>
  )
}

export function ConsentTokens({ consent }: { consent: HitFields["consent"] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {(
        [
          ["ad_storage", consent.adStorage],
          ["analytics_storage", consent.analyticsStorage],
        ] as const
      ).map(([name, value]) => (
        <Badge
          key={name}
          variant="outline"
          className={cn(
            "max-w-full whitespace-normal break-all font-mono text-xs",
            value === "granted" && "border-status-pass-border bg-status-pass-bg text-status-pass",
            value === "denied" && "border-sev-critical-border bg-sev-critical-bg text-sev-critical",
            value !== "granted" && value !== "denied" && "text-muted-foreground",
          )}
        >
          {name} {value}
        </Badge>
      ))}
    </div>
  )
}

const PARAMETER_GLOSSES: Readonly<Record<string, string>> = {
  en: "Event name",
  dl: "Page location",
  tid: "Measurement ID",
  gcs: "Consent state",
  npa: "Non-personalized ads",
  oid: "Order ID",
}

export function KeyValueTable({
  rows,
  empty = "No values.",
  label = "Parameters",
}: {
  rows: ReadonlyArray<readonly [string, string | number]>
  empty?: string
  label?: string
}) {
  const [filter, setFilter] = useState("")
  const filterable = rows.length > 12
  const query = filterable ? filter.trim().toLowerCase() : ""
  const occurrences = new Map<string, number>()
  const visible = rows
    .map(([name, value]) => {
      const occurrence = occurrences.get(name) ?? 0
      occurrences.set(name, occurrence + 1)
      return { name, value, key: `${name}:${occurrence}` }
    })
    .filter(({ name, value }) =>
      `${name} ${value} ${PARAMETER_GLOSSES[name] ?? ""}`.toLowerCase().includes(query),
    )
  return (
    <div className="min-w-0 space-y-2">
      {filterable ? (
        <Input
          type="search"
          aria-label={`Filter ${label.toLowerCase()}`}
          placeholder={`Filter ${label.toLowerCase()}…`}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          className="h-8"
        />
      ) : null}
      {visible.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {rows.length === 0 ? empty : "No values match this filter."}
        </p>
      ) : (
        <Table className="table-fixed text-xs" aria-label={label}>
          <TableBody>
            {visible.map(({ name, value, key }) => (
              <TableRow key={key} className="group">
                <TableCell className="w-2/5 align-top whitespace-normal">
                  <span className="break-all font-mono">{name}</span>
                  {PARAMETER_GLOSSES[name] ? (
                    <span className="mt-0.5 block text-2xs text-muted-foreground">
                      {PARAMETER_GLOSSES[name]}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="whitespace-normal">
                  <div className="flex items-start gap-1">
                    <span className="min-w-0 flex-1 break-all font-mono">{value}</span>
                    <CopyButton
                      value={String(value)}
                      label={`Copy ${name}`}
                      className="-my-1.5 size-6 text-muted-foreground [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100"
                    />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

export function JsonView({ value }: { value: unknown }) {
  const json = JSON.stringify(value, null, 2) ?? "undefined"
  const lines = json.split("\n")
  const [expanded, setExpanded] = useState(false)
  const long = lines.length > 20
  return (
    <Collapsible open={expanded} onOpenChange={setExpanded} className="min-w-0 space-y-1">
      <div className="flex items-center justify-between gap-2">
        {long ? (
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="sm">
              <ChevronDown aria-hidden="true" className={cn(expanded && "rotate-180")} />
              {expanded ? "Collapse JSON" : `Show all ${lines.length} lines`}
            </Button>
          </CollapsibleTrigger>
        ) : (
          <span className="text-xs text-muted-foreground">JSON</span>
        )}
        <CopyButton value={json} label="Copy JSON" />
      </div>
      {long && expanded ? null : (
        <ScrollArea className="rounded-md bg-muted">
          <pre className="p-3 font-mono text-xs break-all whitespace-pre-wrap">
            {long ? lines.slice(0, 20).join("\n") : json}
          </pre>
        </ScrollArea>
      )}
      {long ? (
        <CollapsibleContent>
          <ScrollArea className="h-80 rounded-md bg-muted">
            <pre className="p-3 font-mono text-xs break-all whitespace-pre-wrap">{json}</pre>
          </ScrollArea>
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  )
}

export function RequestView({ request }: { request: CapturedRequest }) {
  const [mode, setMode] = useState("decoded")
  const [bodyOpen, setBodyOpen] = useState(false)
  const query = request.url.includes("?")
    ? request.url.slice(request.url.indexOf("?") + 1).split("#")[0]
    : ""
  return (
    <div className="min-w-0 space-y-3">
      <div className="flex items-start gap-2 font-mono text-xs">
        <span className="py-2 font-semibold">{request.method}</span>
        <span className="min-w-0 flex-1 break-all py-2">{request.url}</span>
        <CopyButton value={request.url} label="Copy request URL" />
      </div>
      <p className="break-all text-xs text-muted-foreground">
        {request.resourceType} · {request.id}
        {request.bodyTruncated ? " · body cut at the engine's limit" : ""}
      </p>
      <ToggleGroup
        type="single"
        value={mode}
        onValueChange={(next) => {
          if (next) setMode(next)
        }}
        variant="outline"
        size="sm"
        aria-label="Request format"
      >
        <ToggleGroupItem value="decoded">Decoded</ToggleGroupItem>
        <ToggleGroupItem value="raw">Raw</ToggleGroupItem>
      </ToggleGroup>
      <Section title="Query string">
        {mode === "decoded" ? (
          <KeyValueTable
            rows={Array.from(new URLSearchParams(query))}
            empty="No query parameters."
            label="Query parameters"
          />
        ) : (
          <Pre>{query || "No query string."}</Pre>
        )}
      </Section>
      {request.body === null ? (
        <p className="text-xs text-muted-foreground">No body.</p>
      ) : (
        <Collapsible open={bodyOpen} onOpenChange={setBodyOpen} className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost" size="sm">
                <ChevronDown aria-hidden="true" className={cn(bodyOpen && "rotate-180")} />
                Request body{request.bodyTruncated ? " (truncated)" : ""}
              </Button>
            </CollapsibleTrigger>
            <CopyButton value={request.body} label="Copy request body" />
          </div>
          <CollapsibleContent>
            <Pre>{request.body}</Pre>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

export function Pairs({
  rows,
  empty,
}: {
  rows: ReadonlyArray<readonly [string, string | number]>
  empty?: string
}) {
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">{empty}</p>
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 font-mono text-xs">
      {rows.map(([name, value]) => (
        <div key={name} className="contents">
          <dt className="text-muted-foreground">{name}</dt>
          <dd className="break-all">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Pre({ children }: { children: string }) {
  return (
    <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 font-mono text-xs break-all whitespace-pre-wrap">
      {children}
    </pre>
  )
}

type HitFields = {
  vendor: string
  destinationId: string
  event: string
  host: string
  at: number
  blocked: boolean
  status: number | null
  afterConsentAction: boolean
  consent: { adStorage: string; analyticsStorage: string; raw?: string }
  ids: Record<string, string>
  params: Record<string, string | number>
}

/** A decoded hit: what it is, the consent state it carried, its ids and parameters. */
export function HitSummary({ hit }: { hit: HitFields }) {
  return (
    <>
      <div className="space-y-1">
        <h2 className="font-medium">
          {hit.vendor} · {hit.event}
        </h2>
        <p className="text-xs text-muted-foreground">
          {hit.destinationId} · {hit.at} ms · {hit.host}
        </p>
        <p className="flex flex-wrap gap-1 text-xs">
          {hit.afterConsentAction ? (
            <Badge variant="secondary" className="bg-sev-warning-bg text-sev-warning">
              sent at or after the consent action
            </Badge>
          ) : null}
          {hit.blocked ? <Badge variant="outline">attempt, not sent to the vendor</Badge> : null}
          {!hit.blocked && hit.status !== null ? (
            <Badge variant="outline">status {hit.status}</Badge>
          ) : null}
        </p>
      </div>
      <Section title="Consent">
        <Pairs
          rows={[
            ["ad storage", hit.consent.adStorage],
            ["analytics storage", hit.consent.analyticsStorage],
            ...(hit.consent.raw === undefined ? [] : [["raw", hit.consent.raw] as const]),
          ]}
        />
      </Section>
      <Section title="Ids">
        <Pairs rows={Object.entries(hit.ids)} empty="No ids." />
      </Section>
      <Section title="Parameters">
        <Pairs rows={Object.entries(hit.params)} empty="No parameters." />
      </Section>
    </>
  )
}

/** A request as captured: method, URL, type and body. */
export function RawRequest({ request }: { request: CapturedRequest }) {
  return (
    <div className="space-y-2" data-testid="raw-request">
      <p className="font-mono text-xs">
        <span className="font-semibold">{request.method}</span>{" "}
        <span className="break-all">{request.url}</span>
      </p>
      <p className="text-xs text-muted-foreground">
        {request.resourceType} · {request.id}
        {request.bodyTruncated ? " · body cut at the engine's limit" : ""}
      </p>
      {request.body === null ? (
        <p className="text-xs text-muted-foreground">No body.</p>
      ) : (
        <Pre>{request.body}</Pre>
      )}
    </div>
  )
}
