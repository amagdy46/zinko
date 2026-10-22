import type { CapturedRequest } from "@repo/capture-contract"
import { Badge } from "@/components/ui/badge"

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
            <Badge variant="secondary" className="bg-warning/15 text-warning">
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
