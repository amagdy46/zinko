import { Link, useRouter } from "@tanstack/react-router"
import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronDown, CircleDashed, LoaderCircle } from "lucide-react"
import { toast } from "sonner"
import {
  ConsentTokens,
  CopyButton,
  JsonView,
  KeyValueTable,
  RequestView,
  Section,
} from "@/components/evidence"
import { CheckStatusBadge } from "@/components/status-badge"
import { StatusGlyph } from "@/components/status-glyph"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { AREAS, BANNER_NOTE, runPage, scenarioLabel } from "@/lib/audit-labels"
import { relativeTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { getAiPolicy } from "@/server/ai-policy"
import { explainFinding, getExplanation } from "@/server/explain"
import { getEvidence, getFinding, listFindings, setTriage } from "@/server/findings"

export type FindingRow = Awaited<ReturnType<typeof listFindings>>["findings"][number]
export type Triage = FindingRow["triage"]["status"]
type FindingDetailData = Awaited<ReturnType<typeof getFinding>>
type Check = FindingDetailData["checks"][number]
type Ref = Check["evidence"][number]
type EvidenceResult = Awaited<ReturnType<typeof getEvidence>>["evidence"]

export const TRIAGE_LABEL: Record<Triage, string> = {
  open: "Open",
  accepted_risk: "Accepted risk",
  fixed: "Fixed",
}

const SEVERITY_LABEL = { critical: "Critical", warning: "Warning", info: "Info" } as const

type Loaded<T> = { state: "loading" } | { state: "failed" } | { state: "ready"; value: T }

const shortDate = (date: Date) =>
  date.toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" })

function TriageLine({ triage }: { triage: FindingDetailData["triage"] }) {
  if (triage.status === "open" || triage.updatedAt === null) return null
  const who = triage.updatedByName ?? "a former member"
  const when = shortDate(triage.updatedAt)
  return (
    <p className="text-sm text-muted-foreground" data-testid="triage-line">
      {triage.status === "accepted_risk"
        ? `Accepted by ${who}, ${when}: ${triage.reason ?? ""}`
        : `Marked fixed by ${who}, ${when}`}
    </p>
  )
}

function TriageMenu({
  status,
  pending,
  onChange,
}: {
  status: Triage
  pending: boolean
  onChange: (status: Triage, reason?: string) => Promise<string | null>
}) {
  const [asking, setAsking] = useState(false)
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)
  const menuButton = useRef<HTMLButtonElement>(null)

  async function accept() {
    const message = await onChange("accepted_risk", reason)
    if (message === null) {
      setAsking(false)
      setReason("")
    }
    setError(message)
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            ref={menuButton}
            variant="outline"
            size="sm"
            disabled={pending}
            data-testid="triage-menu"
            aria-label={`Triage status: ${TRIAGE_LABEL[status]}`}
          >
            {TRIAGE_LABEL[status]}
            <ChevronDown aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuRadioGroup
            value={status}
            onValueChange={(next) => {
              if (next === "accepted_risk") {
                setError(null)
                setAsking(true)
              } else if (next === "open" || next === "fixed") void onChange(next)
            }}
          >
            <DropdownMenuRadioItem value="open">Open</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="accepted_risk">Accept risk</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="fixed">Mark fixed</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            menuButton.current?.focus()
          }}
        >
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              void accept()
            }}
          >
            <DialogHeader>
              <DialogTitle>Accept this risk</DialogTitle>
              <DialogDescription>
                The finding leaves the Open list. Say why, so the next person to look knows.
              </DialogDescription>
            </DialogHeader>
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              aria-label="Reason"
              placeholder="Why is this acceptable?"
              maxLength={1000}
              rows={4}
              required
            />
            {error === null ? null : (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAsking(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || reason.trim() === ""}>
                Accept risk
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function FindingDetail({
  auditId,
  row,
  runs,
}: {
  auditId: string
  row: FindingRow
  runs: ReadonlyArray<{ id: string; screenshotUrl: string | null }>
}) {
  const router = useRouter()
  const [detail, setDetail] = useState<Loaded<FindingDetailData>>({ state: "loading" })
  const [pending, setPending] = useState(false)
  const [pickedRun, setPickedRun] = useState<string | null>(null)
  const [pickedRef, setPickedRef] = useState<Ref | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(
    () =>
      getFinding({ data: { auditId, ruleId: row.ruleId } })
        .then((value) => setDetail({ state: "ready", value }))
        .catch(() => setDetail({ state: "failed" })),
    [auditId, row.ruleId],
  )

  useEffect(() => {
    let current = true
    getFinding({ data: { auditId, ruleId: row.ruleId } })
      .then((value) => current && setDetail({ state: "ready", value }))
      .catch(() => current && setDetail({ state: "failed" }))
    return () => {
      current = false
    }
  }, [auditId, row.ruleId])

  async function changeTriage(status: Triage, reason?: string): Promise<string | null> {
    const message = await save(status, reason)
    setActionError(status === "accepted_risk" ? null : message)
    return message
  }

  async function save(status: Triage, reason?: string): Promise<string | null> {
    setPending(true)
    try {
      const result = await setTriage({ data: { auditId, ruleId: row.ruleId, status, reason } })
      if (!result.ok) return result.message
      toast.success(status === "open" ? "Reopened" : `Moved to ${TRIAGE_LABEL[status]}`)
      await router.invalidate()
      await load()
      return null
    } catch {
      return "The change could not be saved."
    } finally {
      setPending(false)
    }
  }

  const couldNotCheck = row.kind === "inconclusive"
  const triage = detail.state === "ready" ? detail.value.triage : row.triage
  const header = (
    <header className="sticky top-0 z-10 space-y-1 border-b bg-card px-4 py-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {couldNotCheck ? (
          <>
            <StatusGlyph meaning="could-not-check" />
            <span className="font-medium text-foreground">Could not check</span>
          </>
        ) : (
          <>
            <StatusGlyph meaning={row.severity} />
            <span className="font-medium text-foreground">{SEVERITY_LABEL[row.severity]}</span>
          </>
        )}
        <span>{AREAS[row.area] ?? row.area}</span>
        <code className="ml-auto flex items-center gap-0.5">
          {row.ruleId}
          <CopyButton value={row.ruleId} label="Copy rule id" className="-my-1.5" />
        </code>
      </div>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold">{couldNotCheck ? row.checkTitle : row.title}</h2>
        {couldNotCheck ? null : (
          <TriageMenu status={triage.status} pending={pending} onChange={changeTriage} />
        )}
      </div>
      {actionError === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {actionError}
        </p>
      )}
    </header>
  )

  if (detail.state !== "ready")
    return (
      <div>
        {header}
        <div aria-live="polite" className="p-4 text-sm">
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
  const check =
    checks.find((c) => c.runId === pickedRun) ??
    checks.find((c) => c.status === "fail") ??
    checks[0]
  const noted = (["not-detected", "unknown"] as const).filter((d) =>
    checks.some((c) => c.bannerDetection === d),
  )
  const reasons = [
    ...new Set(checks.filter((c) => c.status === "inconclusive").map((c) => c.message)),
  ]

  return (
    <div>
      {header}
      <div className="space-y-5 p-4 text-sm">
        {couldNotCheck ? (
          <Alert role="status" className="border-dashed">
            <CircleDashed aria-hidden="true" />
            <AlertTitle>Not a pass, not a failure</AlertTitle>
            <AlertDescription>
              <p>This check could not run, so nothing here says the tracking is right or wrong.</p>
              <ul className="list-disc pl-4">
                {reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <TriageLine triage={detail.value.triage} />
            {finding.rulesVersions.length > 1 ? (
              <p className="text-xs text-muted-foreground">
                Evaluated with rules versions {finding.rulesVersions.join(", ")}; the text below is
                from the newest.
              </p>
            ) : null}
            <Section title="Why it matters">
              <p>{finding.why}</p>
            </Section>
            <section className="space-y-1">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  How to fix it
                </h3>
                <CopyButton
                  value={finding.fix.map((step, i) => `${i + 1}. ${step}`).join("\n")}
                  label="Copy fix steps"
                />
              </div>
              <ol className="list-decimal space-y-1 pl-5">
                {finding.fix.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </section>
            <ExplainSection auditId={auditId} ruleId={row.ruleId} />
          </>
        )}
        <Section title="Where it was seen">
          {noted.map((detection) => (
            <p key={detection} className="text-xs text-muted-foreground" data-testid="banner-note">
              <StatusGlyph meaning="could-not-check" className="mr-1 inline align-text-bottom" />
              {BANNER_NOTE[detection]} The finding keeps its severity.
            </p>
          ))}
          <Table className="text-xs" aria-label="Where it was seen">
            <TableHeader>
              <TableRow>
                <TableHead>Page</TableHead>
                <TableHead>Scenario</TableHead>
                <TableHead>Viewport</TableHead>
                <TableHead>Check</TableHead>
                <TableHead>Message</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {checks.map((c) => (
                <TableRow
                  key={c.runId}
                  data-testid="check"
                  data-state={c.runId === check?.runId ? "selected" : undefined}
                  onClick={() => {
                    setPickedRun(c.runId)
                    setPickedRef(null)
                  }}
                  className="cursor-pointer"
                >
                  <TableCell className="min-w-28 max-w-48 whitespace-normal">
                    <button
                      type="button"
                      aria-pressed={c.runId === check?.runId}
                      className="break-all text-left font-mono outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      {runPage(c)}
                    </button>
                  </TableCell>
                  <TableCell>{scenarioLabel(c.scenario)}</TableCell>
                  <TableCell>{c.viewport}</TableCell>
                  <TableCell>
                    <CheckStatusBadge status={c.status === "fail" ? "fail" : "inconclusive"} />
                  </TableCell>
                  <TableCell className="min-w-48 whitespace-normal text-muted-foreground">
                    {c.message}
                    {c.bannerDetection === "not-detected" || c.bannerDetection === "unknown" ? (
                      <span className="mt-1 flex items-center gap-1 text-foreground">
                        <StatusGlyph meaning="could-not-check" />
                        {c.bannerDetection === "unknown"
                          ? "Banner status unknown"
                          : "Banner not detected"}
                      </span>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
    </div>
  )
}

type ExplainInfo = Awaited<ReturnType<typeof getExplanation>>
type ExplainOutcome = Extract<Awaited<ReturnType<typeof explainFinding>>, { ok: true }>["value"]
type ExplainFailed = Extract<ExplainOutcome, { ok: false }>
type ExplainProblem = { reason: ExplainFailed["reason"] | "error"; message: string }

const POLL_START_MS = 2000
const POLL_MAX_MS = 15000

const FAILURE_TITLE: Record<ExplainProblem["reason"], string> = {
  off: "Explanations are switched off",
  "no-key": "No API key",
  limit: "Hourly limit reached",
  "in-flight": "Already being written",
  unreadable: "The answer could not be used",
  timeout: "The model did not answer in time",
  provider: "The provider returned an error",
  error: "Could not explain",
}

const WHERE_LABEL = {
  "tag manager": "Tag manager",
  "consent banner": "Consent banner",
  "site code": "Site code",
  server: "Server",
  other: "Other",
} as const

function SettingsLink({ canManage }: { canManage: boolean }) {
  return canManage ? (
    <Link
      to="/app/settings/ai"
      className="inline-flex h-8 items-center rounded-sm font-medium underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      Open Settings &gt; AI
    </Link>
  ) : (
    <span>Ask an owner or admin.</span>
  )
}

/**
 * The model explains a finding the rule already decided. It only runs after a click on Explain or
 * Regenerate, and its text is shown as plain text.
 */
function ExplainSection({ auditId, ruleId }: { auditId: string; ruleId: string }) {
  const [info, setInfo] = useState<Loaded<ExplainInfo>>({ state: "loading" })
  const [canManage, setCanManage] = useState(false)
  const [writing, setWriting] = useState(false)
  const [problem, setProblem] = useState<ExplainProblem | null>(null)
  const [disclosure, setDisclosure] = useState(false)
  const [polls, setPolls] = useState(0)

  const refetch = useCallback(
    () =>
      getExplanation({ data: { auditId, ruleId } })
        .then((value) => setInfo({ state: "ready", value }))
        .catch(() => setInfo({ state: "failed" })),
    [auditId, ruleId],
  )

  useEffect(() => {
    let current = true
    getExplanation({ data: { auditId, ruleId } })
      .then((value) => current && setInfo({ state: "ready", value }))
      .catch(() => current && setInfo({ state: "failed" }))
    getAiPolicy()
      .then((policy) => current && setCanManage(policy.canManage))
      .catch(() => current && setCanManage(false))
    return () => {
      current = false
    }
  }, [auditId, ruleId])

  const waiting = info.state === "ready" && info.value.enabled && info.value.inFlight && !writing
  useEffect(() => {
    if (!waiting) return undefined
    const timer = setTimeout(
      () => {
        void refetch().then(() => setPolls((n) => n + 1))
      },
      Math.min(POLL_START_MS * 2 ** polls, POLL_MAX_MS),
    )
    return () => clearTimeout(timer)
  }, [waiting, polls, refetch])

  async function generate(regenerate: boolean) {
    setWriting(true)
    setProblem(null)
    setPolls(0)
    try {
      const result = await explainFinding({ data: { auditId, ruleId, regenerate } })
      if (!result.ok) setProblem({ reason: "error", message: result.message })
      else if (!result.value.ok) setProblem(result.value)
      await refetch()
    } catch {
      setProblem({ reason: "error", message: "The explanation could not be requested." })
    } finally {
      setWriting(false)
    }
  }

  const heading = (
    <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      Explanation
    </h3>
  )
  if (info.state !== "ready")
    return (
      <section className="space-y-1" data-testid="explain">
        {heading}
        {info.state === "loading" ? (
          <p className="text-muted-foreground">Loading</p>
        ) : (
          <p role="alert" className="text-destructive">
            The explanation could not be loaded.
          </p>
        )}
      </section>
    )
  const state = info.value
  if (!state.enabled)
    return (
      <section className="space-y-1" data-testid="explain">
        {heading}
        <p className="text-muted-foreground">
          AI explanations are switched off for this organization. The steps above are the
          rule&apos;s standard steps. <SettingsLink canManage={canManage} />
        </p>
      </section>
    )

  const cached = state.cached
  const pending = writing || state.inFlight
  const stale =
    cached !== null &&
    state.current !== null &&
    (cached.model !== state.current.model || cached.provider !== state.current.provider)
  const mayAsk = state.canGenerate && (cached === null || state.canRegenerate)
  let askLabel = `Explain with ${state.current?.model}`
  if (cached !== null) askLabel = stale ? `Regenerate with ${state.current?.model}` : "Regenerate"
  const written = cached === null ? null : relativeTime(cached.createdAt)

  return (
    <section className="space-y-2" data-testid="explain">
      {heading}
      {state.configured ? null : (
        <p className="text-muted-foreground">
          AI explanations need a key.{" "}
          {cached === null
            ? "The steps above are the rule's standard steps. "
            : "The text below was written before it was removed and cannot be regenerated. "}
          <SettingsLink canManage={canManage} />
        </p>
      )}
      {cached === null || written === null ? null : (
        <div className="space-y-3 rounded-md border p-3" data-testid="explanation">
          <p className="font-medium">{cached.explanation.summary}</p>
          {cached.explanation.whatWeSaw.length === 0 ? null : (
            <div className="space-y-1">
              <h4 className="text-xs font-medium text-muted-foreground">What we saw</h4>
              <ul className="list-disc space-y-1 pl-5">
                {cached.explanation.whatWeSaw.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}
          {cached.explanation.likelyCauses.length === 0 ? null : (
            <div className="space-y-1">
              <h4 className="text-xs font-medium text-muted-foreground">Likely causes</h4>
              <ul className="list-disc space-y-1 pl-5">
                {cached.explanation.likelyCauses.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}
          {cached.explanation.fixSteps.length === 0 ? null : (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-medium text-muted-foreground">Suggested steps</h4>
                <CopyButton
                  value={cached.explanation.fixSteps
                    .map((fix, i) => `${i + 1}. ${fix.step}`)
                    .join("\n")}
                  label="Copy suggested steps"
                />
              </div>
              <ol className="list-decimal space-y-1 pl-5">
                {cached.explanation.fixSteps.map((fix) => (
                  <li key={fix.step}>
                    {fix.step}{" "}
                    <Badge variant="outline" className="align-middle">
                      {WHERE_LABEL[fix.where]}
                    </Badge>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <div className="space-y-1">
            <h4 className="text-xs font-medium text-muted-foreground">How to verify</h4>
            <p>{cached.explanation.verify}</p>
          </div>
          <p className="text-xs text-muted-foreground" data-testid="explanation-footer">
            <Badge variant="secondary" className="mr-1 align-middle">
              AI-written
            </Badge>
            Written by {cached.model} ({cached.provider}),{" "}
            <time dateTime={cached.createdAt.toISOString()} title={written.title}>
              {written.text}
            </time>
            .{cached.createdByName === null ? "" : ` Asked by ${cached.createdByName}.`} Check it
            against the evidence below. The rule, not the model, decided this finding.
          </p>
        </div>
      )}
      {mayAsk ? (
        <Collapsible open={disclosure} onOpenChange={setDisclosure} className="space-y-1">
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="sm">
              <ChevronDown aria-hidden="true" className={cn(disclosure && "rotate-180")} />
              What will be sent
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-1">
            <p className="text-xs text-muted-foreground">
              {state.policyId === "paths"
                ? "Page paths are included, without their query strings."
                : "Pages are sent as aliases (Page 1, Page 2)."}{" "}
              Exactly this is sent to {state.current?.provider} with instructions to explain it.
              Cookie values, click ids, URLs and parameters never are.
            </p>
            <JsonView value={state.digest} />
          </CollapsibleContent>
        </Collapsible>
      ) : null}
      {pending ? (
        <p
          aria-live="polite"
          className="flex items-center gap-2 text-muted-foreground"
          data-testid="explain-pending"
        >
          <LoaderCircle
            aria-hidden="true"
            className="size-4 animate-spin motion-reduce:animate-none"
          />
          {writing ? "Writing explanation" : "Another member is already writing this"}
        </p>
      ) : null}
      {problem === null ? null : (
        <Alert variant="destructive" data-testid="explain-error">
          <AlertTitle>{FAILURE_TITLE[problem.reason]}</AlertTitle>
          <AlertDescription>
            <p>{problem.message}</p>
          </AlertDescription>
        </Alert>
      )}
      {mayAsk ? (
        <Button
          type="button"
          variant={cached === null ? "default" : "outline"}
          size="sm"
          disabled={pending || problem?.reason === "limit"}
          onClick={() => void generate(cached !== null)}
          data-testid="explain-button"
        >
          {askLabel}
        </Button>
      ) : null}
    </section>
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
  const refsOf = (t: Tab) =>
    t === "screenshot" ? [] : check.evidence.filter((e) => TAB_REFS[t].includes(e.kind))
  const available = (t: Tab) => (t === "screenshot" ? screenshotUrl !== null : refsOf(t).length > 0)
  const first = check.evidence[0]
  const preferred = first === undefined ? undefined : FIRST_TAB[first.kind]
  const [tab, setTab] = useState<Tab | undefined>(
    preferred !== undefined && available(preferred) ? preferred : TABS.find(available),
  )

  return (
    <Section title="Evidence">
      <Tabs
        value={tab ?? ""}
        onValueChange={(value) => {
          setTab(TABS.find((t) => t === value))
        }}
      >
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t} value={t} disabled={!available(t)}>
              {TAB_LABEL[t]}
              {t !== "screenshot" ? (
                <span className="text-xs text-muted-foreground">{refsOf(t).length}</span>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>
        {tab === undefined ? (
          <p className="text-xs text-muted-foreground">This check cites no evidence.</p>
        ) : (
          <TabsContent value={tab} className="space-y-2">
            <TabBody
              auditId={auditId}
              runId={check.runId}
              tab={tab}
              refs={refsOf(tab)}
              firstRef={first}
              picked={picked}
              onPick={onPick}
              screenshotUrl={screenshotUrl}
            />
          </TabsContent>
        )}
      </Tabs>
    </Section>
  )
}

function OpenInHits({
  auditId,
  runId,
  reference,
}: {
  auditId: string
  runId: string
  reference: Ref
}) {
  let search: { run: string; hit: string } | { runId: string; source?: "dataLayer" } = { runId }
  if (reference.kind === "hit")
    search = { run: runId, hit: `${reference.requestId}:${reference.batchIndex}` }
  if (reference.kind === "push") search = { runId, source: "dataLayer" }
  return (
    <Button asChild variant="ghost" size="sm">
      <Link to="/app/audits/$auditId/hits" params={{ auditId }} search={search}>
        Open in Hits
      </Link>
    </Button>
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
  if (ref === undefined) return null
  return (
    <>
      <div className="flex flex-wrap items-center gap-1">
        {refs.length > 1 ? (
          refs.map((r) => (
            <Button
              key={refKey(r)}
              variant={r === ref ? "secondary" : "outline"}
              size="sm"
              aria-pressed={r === ref}
              onClick={() => onPick(r)}
            >
              {refLabel(r)}
            </Button>
          ))
        ) : (
          <span className="break-all font-mono text-xs text-muted-foreground">{refLabel(ref)}</span>
        )}
        <span className="ml-auto">
          <OpenInHits auditId={auditId} runId={runId} reference={ref} />
        </span>
      </div>
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

function HitFacts({ hit }: { hit: Extract<EvidenceResult, { kind: "hit" }>["hit"] }) {
  return (
    <div className="min-w-0 space-y-3">
      <div className="space-y-1">
        <p className="font-medium">
          {hit.vendor} · {hit.event}
        </p>
        <p className="break-all text-xs text-muted-foreground">
          {hit.destinationId} · {hit.at} ms · {hit.host}
        </p>
        <div className="flex flex-wrap gap-1 text-xs">
          {hit.afterConsentAction ? (
            <Badge variant="outline">sent at or after the consent action</Badge>
          ) : null}
          {hit.blocked ? <Badge variant="outline">attempt, not sent to the vendor</Badge> : null}
          {!hit.blocked && hit.status !== null ? (
            <Badge variant="outline">status {hit.status}</Badge>
          ) : null}
        </div>
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
    </div>
  )
}

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
      <HitFacts hit={evidence.hit} />
    ) : (
      <RequestView request={evidence.request} />
    )
  if (evidence.kind === "request") return <RequestView request={evidence.request} />
  if (evidence.kind === "document")
    return (
      <KeyValueTable
        label="Document"
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
        <KeyValueTable
          label="Cookie"
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
      <JsonView value={evidence.value} />
    </div>
  )
}
