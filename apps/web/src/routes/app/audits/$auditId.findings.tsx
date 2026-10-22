import { createFileRoute, getRouteApi, Link, useRouter } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { HitSummary, Pairs, Pre, RawRequest, Section } from "@/components/evidence"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { runPage, scenarioLabel } from "@/lib/audit-labels"
import { cn } from "@/lib/utils"
import { getEvidence, getFinding, listFindings, setTriage } from "@/server/findings"

const auditRoute = getRouteApi("/app/audits/$auditId")

type Search = { finding?: string }

const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : undefined)

export const Route = createFileRoute("/app/audits/$auditId/findings")({
  validateSearch: (search: Record<string, unknown>): Search => ({ finding: text(search.finding) }),
  loader: ({ params }) => listFindings({ data: { auditId: params.auditId } }),
  notFoundComponent: () => <p className="text-sm text-muted-foreground">Audit not found.</p>,
  component: FindingsScreen,
})

type Listing = Awaited<ReturnType<typeof listFindings>>
type FindingRow = Listing["findings"][number]
type FindingDetail = Awaited<ReturnType<typeof getFinding>>
type Check = FindingDetail["checks"][number]
type Ref = Check["evidence"][number]
type Triage = FindingRow["triage"]["status"]

const AREAS: Record<string, string> = {
  consent: "Consent",
  clickids: "Click IDs",
  coverage: "Coverage",
  duplicates: "Duplicates",
  dedup: "Dedup",
  hygiene: "Hygiene",
}

const SEVERITIES: Record<FindingRow["severity"], { label: string; tone: string }> = {
  critical: { label: "Critical", tone: "bg-destructive/10 text-destructive" },
  warning: { label: "Warning", tone: "bg-warning/15 text-warning" },
  info: { label: "Info", tone: "bg-muted text-muted-foreground" },
}

const TRIAGE_LABEL: Record<Triage, string> = {
  open: "Open",
  accepted_risk: "Accepted risk",
  fixed: "Fixed",
}

const COPY_LABEL = { idle: "Copy fix steps", copied: "Copied", failed: "Could not copy" }

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`

function SeverityBadge({ severity }: { severity: FindingRow["severity"] }) {
  const { label, tone } = SEVERITIES[severity]
  return (
    <Badge variant="secondary" className={tone}>
      {label}
    </Badge>
  )
}

function FindingsScreen() {
  const { audit } = auditRoute.useLoaderData()
  const { status, coverage, findings } = Route.useLoaderData()
  const { finding: ruleId } = Route.useSearch()
  // findings are written when the audit finishes, check results as each run is saved; the status
  // comes with the findings, not from the audit loader, which may be a moment ahead of them
  const finished = ["complete", "partial", "failed"].includes(status)
  const active = !finished

  if (coverage.evaluatedRuns === 0)
    return (
      <div className="rounded-lg border bg-card p-4 text-sm" data-testid="not-evaluated">
        <h2 className="font-medium">{active ? "Checks are still to come" : "Not evaluated"}</h2>
        <p className="mt-1 text-muted-foreground">
          {active
            ? "Each run is checked as it is saved. Findings appear here as they are written."
            : "No run of this audit has check results: it ran before Zinko checked rules, or none of its runs was saved. Nothing can be said about its tracking, and it is not clean."}
        </p>
      </div>
    )

  const failing = findings.filter((f) => f.kind === "fail")
  const unchecked = findings.filter((f) => f.kind === "inconclusive")
  const selected = findings.find((f) => f.ruleId === ruleId) ?? failing[0] ?? unchecked[0]
  const full = coverage.evaluatedRuns >= coverage.totalRuns
  const missing = coverage.totalRuns - coverage.evaluatedRuns

  return (
    <div className="space-y-4">
      <div
        className={cn(
          "rounded-lg border p-3 text-sm",
          full ? "bg-card" : "border-warning/50 bg-warning/10",
        )}
        data-testid="coverage"
      >
        <p className="font-medium">
          {coverage.evaluatedRuns} of {plural(coverage.totalRuns, "run")} evaluated
        </p>
        {full ? null : (
          <p className="text-muted-foreground">
            {plural(missing, "run")}{" "}
            {active ? "still to be checked" : `${missing === 1 ? "has" : "have"} no check results`},
            so what follows may be incomplete.
          </p>
        )}
        {coverage.rulesVersions.length > 1 ? (
          <p className="text-muted-foreground" data-testid="mixed-versions">
            The runs were evaluated with different versions of the rules (
            {coverage.rulesVersions.join(", ")}). The checks and their wording can differ between
            them.
          </p>
        ) : null}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="space-y-4">
          <FindingGroup
            title="Findings"
            rows={failing}
            selected={selected}
            auditId={audit.id}
            empty={
              <EmptyFindings
                finished={finished}
                full={full}
                evaluated={coverage.evaluatedRuns}
                missing={missing}
                couldNotCheck={unchecked.length}
              />
            }
          />
          {unchecked.length === 0 ? null : (
            <FindingGroup
              title="Could not check"
              hint="The page or the consent banner did not allow these checks to run. They are not passes."
              rows={unchecked}
              selected={selected}
              auditId={audit.id}
            />
          )}
        </div>
        <aside
          aria-label="Finding"
          className="rounded-lg border bg-card p-3 text-sm lg:sticky lg:top-4"
        >
          {selected === undefined ? (
            <p className="text-muted-foreground">Select a finding to see its evidence.</p>
          ) : (
            <Detail key={selected.ruleId} auditId={audit.id} row={selected} />
          )}
        </aside>
      </div>
    </div>
  )
}

function EmptyFindings({
  finished,
  full,
  evaluated,
  missing,
  couldNotCheck,
}: {
  finished: boolean
  full: boolean
  evaluated: number
  missing: number
  couldNotCheck: number
}) {
  if (!finished)
    return (
      <p className="text-sm" data-testid="collecting">
        Checks are being collected. Findings are written when the audit finishes, so none are known
        yet.
      </p>
    )
  if (couldNotCheck > 0)
    return (
      <p className="text-sm" data-testid="only-inconclusive">
        Nothing failed, but {plural(couldNotCheck, "check")} could not be run. This audit is not
        confirmed clean.
      </p>
    )
  if (!full)
    return (
      <p className="text-sm" data-testid="partial-clean">
        No findings were recorded for the {plural(evaluated, "evaluated run")}, but{" "}
        {plural(missing, "run")} could not be evaluated, so this audit is not confirmed clean.
      </p>
    )
  return (
    <p className="text-sm" data-testid="no-findings">
      No findings. All {plural(evaluated, "run")} were evaluated, and every check passed or did not
      apply.
    </p>
  )
}

function FindingGroup({
  title,
  hint,
  rows,
  selected,
  auditId,
  empty,
}: {
  title: string
  hint?: string
  rows: ReadonlyArray<FindingRow>
  selected: FindingRow | undefined
  auditId: string
  empty?: React.ReactNode
}) {
  return (
    <section className="space-y-2" aria-label={title}>
      <div>
        <h2 className="text-sm font-medium">
          {title} <span className="text-muted-foreground">({rows.length})</span>
        </h2>
        {hint === undefined ? null : <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {rows.length === 0 ? (
        empty
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.ruleId}>
              <FindingItem row={row} auditId={auditId} selected={row.ruleId === selected?.ruleId} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function FindingItem({
  row,
  auditId,
  selected,
}: {
  row: FindingRow
  auditId: string
  selected: boolean
}) {
  return (
    <Link
      to="/app/audits/$auditId/findings"
      params={{ auditId }}
      search={{ finding: row.ruleId }}
      replace
      data-testid="finding"
      data-selected={selected}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "block space-y-1.5 rounded-lg border bg-card p-3 text-sm outline-none hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50",
        selected && "border-primary bg-accent",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={row.severity} />
        <span className="text-xs text-muted-foreground">{AREAS[row.area] ?? row.area}</span>
        {row.triage.status === "open" ? null : (
          <Badge variant="outline">{TRIAGE_LABEL[row.triage.status]}</Badge>
        )}
      </div>
      <p className="font-medium">{row.title}</p>
      <p className="text-xs text-muted-foreground">
        {plural(row.pages, "page")} · {plural(row.scenarios, "scenario")}
        {row.kind === "fail" && row.inconclusiveRuns > 0
          ? ` · ${row.inconclusiveRuns} inconclusive`
          : ""}
      </p>
    </Link>
  )
}

type Loaded<T> = { state: "loading" } | { state: "failed" } | { state: "ready"; value: T }

function Detail({ auditId, row }: { auditId: string; row: FindingRow }) {
  const router = useRouter()
  const { runs } = auditRoute.useLoaderData()
  const [detail, setDetail] = useState<Loaded<FindingDetail>>({ state: "loading" })
  const [triage, setTriageState] = useState<FindingDetail["triage"] | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<keyof typeof COPY_LABEL>("idle")
  const [pickedRun, setPickedRun] = useState<string | null>(null)
  const [pickedRef, setPickedRef] = useState<Ref | null>(null)

  useEffect(() => {
    let current = true
    getFinding({ data: { auditId, ruleId: row.ruleId } })
      .then((value) => current && setDetail({ state: "ready", value }))
      .catch(() => current && setDetail({ state: "failed" }))
    return () => {
      current = false
    }
  }, [auditId, row.ruleId])

  async function changeTriage(status: Triage) {
    setPending(true)
    setError(null)
    try {
      const result = await setTriage({ data: { auditId, ruleId: row.ruleId, status } })
      if (!result.ok) setError(result.message)
      else {
        setTriageState(result.value)
        await router.invalidate()
      }
    } catch {
      setError("The change could not be saved.")
    } finally {
      setPending(false)
    }
  }

  async function copyFix(fix: ReadonlyArray<string>) {
    try {
      await navigator.clipboard.writeText(fix.map((step, i) => `${i + 1}. ${step}`).join("\n"))
      setCopied("copied")
    } catch {
      setCopied("failed")
    }
  }

  const header = (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={row.severity} />
        <span className="text-xs text-muted-foreground">{AREAS[row.area] ?? row.area}</span>
        <code className="text-xs text-muted-foreground">{row.ruleId}</code>
      </div>
      <h2 className="text-base font-medium">{row.title}</h2>
    </div>
  )

  if (detail.state !== "ready")
    return (
      <div className="space-y-3">
        {header}
        <div aria-live="polite">
          {detail.state === "loading" ? <p className="text-muted-foreground">Loading</p> : null}
          {detail.state === "failed" ? (
            <p role="alert" className="text-destructive">
              This finding could not be loaded.
            </p>
          ) : null}
        </div>
      </div>
    )

  const { finding, checks } = detail.value
  const status = (triage ?? detail.value.triage).status
  const check =
    checks.find((c) => c.runId === pickedRun) ??
    checks.find((c) => c.status === "fail") ??
    checks[0]
  const hitRef =
    pickedRef?.kind === "hit" ? pickedRef : check?.evidence.find((e) => e.kind === "hit")
  const actions: ReadonlyArray<{ status: Triage; label: string }> = [
    { status: "accepted_risk", label: "Accept risk" },
    { status: "fixed", label: "Mark fixed" },
    { status: "open", label: "Reopen" },
  ]

  return (
    <div className="space-y-4">
      {header}
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" data-testid="triage-status">
          {TRIAGE_LABEL[status]}
        </Badge>
        {actions
          .filter((a) => a.status !== status)
          .map((a) => (
            <Button
              key={a.status}
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => void changeTriage(a.status)}
            >
              {a.label}
            </Button>
          ))}
        <Button variant="outline" size="sm" onClick={() => void copyFix(finding.fix)}>
          {COPY_LABEL[copied]}
        </Button>
        {check === undefined ? null : (
          <Button asChild variant="outline" size="sm">
            <Link
              to="/app/audits/$auditId/hits"
              params={{ auditId }}
              search={
                hitRef?.kind === "hit"
                  ? { run: check.runId, hit: `${hitRef.requestId}:${hitRef.batchIndex}` }
                  : { runId: check.runId }
              }
            >
              Open in Hits
            </Link>
          </Button>
        )}
      </div>
      {error === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {finding.kind === "inconclusive" ? (
        <p className="rounded-md border border-warning/50 bg-warning/10 p-2 text-sm">
          This could not be checked, which is different from passing. Nothing here says the tracking
          is right or wrong.
        </p>
      ) : null}
      {finding.rulesVersions.length > 1 ? (
        <p className="text-xs text-muted-foreground">
          Evaluated with rules versions {finding.rulesVersions.join(", ")}; the text below is from
          the newest.
        </p>
      ) : null}
      <Section title="Why it matters">
        <p>{finding.why}</p>
      </Section>
      <Section title="How to fix it">
        <ol className="list-decimal space-y-1 pl-5">
          {finding.fix.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </Section>
      <Section title="Where it was seen">
        <ul className="space-y-1.5">
          {checks.map((c) => (
            <li key={c.runId}>
              <button
                type="button"
                data-testid="check"
                aria-pressed={c.runId === check?.runId}
                onClick={() => {
                  setPickedRun(c.runId)
                  setPickedRef(null)
                }}
                className={cn(
                  "w-full space-y-0.5 rounded-md border p-2 text-left outline-none hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  c.runId === check?.runId && "border-primary bg-accent",
                )}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <code className="text-xs break-all">{runPage(c)}</code>
                  <span className="text-xs text-muted-foreground">
                    {scenarioLabel(c.scenario)} · {c.viewport}
                  </span>
                  <Badge
                    variant="secondary"
                    className={
                      c.status === "fail"
                        ? "bg-destructive/10 text-destructive"
                        : "bg-warning/15 text-warning"
                    }
                  >
                    {c.status}
                  </Badge>
                </span>
                <span className="block text-xs text-muted-foreground">{c.message}</span>
              </button>
            </li>
          ))}
        </ul>
      </Section>
      {check === undefined ? null : (
        <Evidence
          key={check.runId}
          auditId={auditId}
          check={check}
          picked={pickedRef}
          onPick={setPickedRef}
          screenshotUrl={runs.find((r) => r.id === check.runId)?.screenshotUrl ?? null}
        />
      )}
    </div>
  )
}

const TABS = ["hit", "request", "screenshot", "cookies", "datalayer"] as const
type Tab = (typeof TABS)[number]

const FIRST_TAB: Record<Ref["kind"], Tab> = {
  hit: "hit",
  request: "request",
  document: "request",
  cookie: "cookies",
  push: "datalayer",
}

const TAB_REFS: Record<Exclude<Tab, "screenshot">, ReadonlyArray<Ref["kind"]>> = {
  hit: ["hit"],
  request: ["hit", "request", "document"],
  cookies: ["cookie"],
  datalayer: ["push"],
}

const TAB_LABEL: Record<Tab, string> = {
  hit: "Hit",
  request: "Request",
  screenshot: "Screenshot",
  cookies: "Cookies",
  datalayer: "dataLayer",
}

const refLabel = (ref: Ref) => {
  if (ref.kind === "hit") return `${ref.requestId} #${ref.batchIndex}`
  if (ref.kind === "request") return ref.requestId
  if (ref.kind === "cookie") return `${ref.name} (${ref.label})`
  if (ref.kind === "push") return `push ${ref.seq}`
  return `document ${ref.documentId}`
}

const refKey = (ref: Ref) => JSON.stringify(ref)

function Evidence({
  auditId,
  check,
  picked,
  onPick,
  screenshotUrl,
}: {
  auditId: string
  check: Check
  picked: Ref | null
  onPick: (ref: Ref) => void
  screenshotUrl: string | null
}) {
  const first = check.evidence[0]
  const [tab, setTab] = useState<Tab>(first === undefined ? "screenshot" : FIRST_TAB[first.kind])
  const refsOf = (t: Tab) =>
    t === "screenshot" ? [] : check.evidence.filter((e) => TAB_REFS[t].includes(e.kind))

  return (
    <Section title="Evidence">
      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(TABS.find((t) => t === value) ?? "hit")
        }}
      >
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t} value={t}>
              {TAB_LABEL[t]}
              {t !== "screenshot" ? (
                <span className="text-xs text-muted-foreground">{refsOf(t).length}</span>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={tab} className="space-y-2">
          <TabBody
            auditId={auditId}
            runId={check.runId}
            tab={tab}
            refs={refsOf(tab)}
            firstRef={check.evidence[0]}
            picked={picked}
            onPick={onPick}
            screenshotUrl={screenshotUrl}
          />
        </TabsContent>
      </Tabs>
    </Section>
  )
}

function TabBody({
  auditId,
  runId,
  tab,
  refs,
  firstRef,
  picked,
  onPick,
  screenshotUrl,
}: {
  auditId: string
  runId: string
  tab: Tab
  refs: ReadonlyArray<Ref>
  firstRef: Ref | undefined
  picked: Ref | null
  onPick: (ref: Ref) => void
  screenshotUrl: string | null
}) {
  if (tab === "screenshot")
    return (
      <Screenshot auditId={auditId} runId={runId} reference={firstRef} loaderUrl={screenshotUrl} />
    )
  const ref = refs.find((r) => picked !== null && refKey(r) === refKey(picked)) ?? refs[0]
  if (ref === undefined)
    return (
      <p className="text-xs text-muted-foreground">
        This check points at no {TAB_LABEL[tab]} evidence.
      </p>
    )
  return (
    <>
      {refs.length > 1 ? (
        <div className="flex flex-wrap gap-1">
          {refs.map((r) => (
            <Button
              key={refKey(r)}
              variant={r === ref ? "secondary" : "outline"}
              size="xs"
              aria-pressed={r === ref}
              onClick={() => onPick(r)}
            >
              {refLabel(r)}
            </Button>
          ))}
        </div>
      ) : null}
      <EvidenceView key={refKey(ref)} auditId={auditId} runId={runId} tab={tab} reference={ref} />
    </>
  )
}

/**
 * The run's final screenshot. A signed URL lasts 5 minutes, so opening the tab asks for a fresh
 * one through any of the check's evidence (the audit loader's URL when it has none), and an image
 * that fails to load is asked for once more.
 */
function Screenshot({
  auditId,
  runId,
  reference,
  loaderUrl,
}: {
  auditId: string
  runId: string
  reference: Ref | undefined
  loaderUrl: string | null
}) {
  const router = useRouter()
  const [fresh, setFresh] = useState<string | null | undefined>(undefined)
  const url = reference === undefined ? loaderUrl : fresh
  const [retried, setRetried] = useState(false)
  const [broken, setBroken] = useState(false)

  useEffect(() => {
    let current = true
    if (reference !== undefined)
      getEvidence({ data: { auditId, runId, ref: reference } })
        .then((value) => current && setFresh(value.screenshotUrl))
        .catch(() => current && setBroken(true))
    return () => {
      current = false
    }
  }, [auditId, runId, reference])

  function failed() {
    if (retried) {
      setBroken(true)
      return
    }
    setRetried(true)
    if (reference === undefined) void router.invalidate()
    else
      getEvidence({ data: { auditId, runId, ref: reference } })
        .then((value) => setFresh(value.screenshotUrl))
        .catch(() => setBroken(true))
  }

  if (broken)
    return (
      <p role="alert" className="text-xs text-destructive">
        The screenshot could not be loaded.
      </p>
    )
  if (url === undefined) return <p className="text-xs text-muted-foreground">Loading</p>
  if (url === null)
    return <p className="text-xs text-muted-foreground">This run has no screenshot.</p>
  return (
    <figure className="space-y-1">
      <img
        src={url}
        alt="The page at the end of the run"
        onError={failed}
        className="w-full rounded-md border object-cover object-top"
      />
      <figcaption className="text-xs text-muted-foreground">
        Taken at the end of the run, not at the moment of the evidence.
      </figcaption>
    </figure>
  )
}

type EvidenceResult = Awaited<ReturnType<typeof getEvidence>>["evidence"]

function EvidenceView({
  auditId,
  runId,
  tab,
  reference,
}: {
  auditId: string
  runId: string
  tab: Tab
  reference: Ref
}) {
  const [loaded, setLoaded] = useState<Loaded<EvidenceResult>>({ state: "loading" })

  useEffect(() => {
    let current = true
    getEvidence({ data: { auditId, runId, ref: reference } })
      .then((value) => current && setLoaded({ state: "ready", value: value.evidence }))
      .catch(() => current && setLoaded({ state: "failed" }))
    return () => {
      current = false
    }
  }, [auditId, runId, reference])

  if (loaded.state === "loading") return <p className="text-muted-foreground">Loading</p>
  if (loaded.state === "failed")
    return (
      <p role="alert" className="text-destructive">
        This evidence could not be loaded.
      </p>
    )
  const evidence = loaded.value
  if (evidence.kind === "hit")
    return tab === "hit" ? (
      <div className="space-y-3">
        <HitSummary hit={evidence.hit} />
      </div>
    ) : (
      <RawRequest request={evidence.request} />
    )
  if (evidence.kind === "request") return <RawRequest request={evidence.request} />
  if (evidence.kind === "document")
    return (
      <Pairs
        rows={[
          ["url", evidence.document.url],
          ["title", evidence.document.title ?? "-"],
          ["started", `${evidence.document.startedAt} ms`],
          ...evidence.document.redirects.map((hop, i) => [`redirect ${i + 1}`, hop] as const),
        ]}
      />
    )
  if (evidence.kind === "cookie")
    return (
      <div className="space-y-2">
        <Pairs
          rows={[
            ["name", evidence.cookie.name],
            ["value", evidence.cookie.value],
            ["domain", evidence.cookie.domain],
            ["path", evidence.cookie.path],
            [
              "expires",
              evidence.cookie.expires === null
                ? "session"
                : new Date(evidence.cookie.expires * 1000).toISOString(),
            ],
            ["secure", String(evidence.cookie.secure)],
            ["httpOnly", String(evidence.cookie.httpOnly)],
            ["sameSite", evidence.cookie.sameSite],
          ]}
        />
        <p className="text-xs text-muted-foreground">
          Seen in the {evidence.snapshot.label} snapshot at {evidence.snapshot.at} ms.
        </p>
      </div>
    )
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        dataLayer push {evidence.seq} at {evidence.at} ms
      </p>
      <Pre>{JSON.stringify(evidence.value, null, 2)}</Pre>
    </div>
  )
}
