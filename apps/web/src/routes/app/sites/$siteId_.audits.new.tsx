import { NotFound } from "@/components/not-found"
import type { Scenario } from "@repo/capture-contract"
import { AuditConfig, JOURNEY_STEPS } from "@repo/core/audit"
import { createFileRoute, useRouter } from "@tanstack/react-router"
import { Option, Schema } from "effect"
import { CircleHelp } from "lucide-react"
import { type FormEvent, type ReactNode, useRef, useState } from "react"
import { SampleReportLink } from "@/components/sample-report-link"
import { PageContainer } from "@/components/page-container"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import { useHydrated } from "@/lib/use-hydrated"
import { pageTitle } from "@/lib/page-title"
import { LOCAL_ANSWER_SENTENCE, runBreakdown, SCENARIOS } from "@/lib/audit-labels"
import { carryOverText } from "@/lib/carry-over"
import { count, shortDate, useTimeZone } from "@/lib/format"
import {
  isOnSite,
  onSiteScheme,
  originHost,
  resolveOnSite,
  withoutCredentials,
} from "@/lib/site-url"
import { startAudit } from "@/server/audits"
import { getSite } from "@/server/clients"

const StartPath = Schema.String.check(Schema.isMaxLength(2000))
const decodeStartPath = Schema.decodeUnknownOption(StartPath)

export const Route = createFileRoute("/app/sites/$siteId_/audits/new")({
  validateSearch: (search: Record<string, unknown>): { start?: string } => {
    const start = Option.getOrUndefined(decodeStartPath(search.start))
    return start !== undefined && start.startsWith("/") && !start.startsWith("//") ? { start } : {}
  },
  loader: ({ params }) => getSite({ data: { id: params.siteId } }),
  head: ({ loaderData }) => pageTitle("New audit", loaderData?.site.name ?? "Site"),
  notFoundComponent: () => <NotFound what="Site" />,
  component: NewAudit,
})

const MAX_KEY_PAGES = 19
const DEFAULT_SCENARIOS: ReadonlyArray<Scenario> = ["none", "accept", "reject"]
const decodeConfig = Schema.decodeUnknownOption(AuditConfig)

const VIEWPORTS = ["desktop", "mobile"] as const

type SiteScope = { host: string; origin: string; measuredHosts: ReadonlyArray<string> }

const urlError = (value: string, site: SiteScope) => {
  if (!URL.canParse(value)) return "Enter a valid URL."
  if (!isOnSite(value, site))
    return `Use an http(s) URL on ${originHost(site.origin)}, without a username or password.`
  return undefined
}

const keyPageError = (value: string, site: SiteScope) =>
  URL.canParse(value)
    ? urlError(value, site)
    : "Enter a URL on this site or a path starting with /, such as /checkout."

/** The server's message starts with the URL it refused; this puts it under that URL's input. */
const errorFor = (message: string, start: string, keyPages: ReadonlyArray<string>): Errors => {
  const names = (url: string) =>
    message.startsWith(`${url} `) || message.startsWith(`${withoutCredentials(url)} `)
  if (names(start)) return { startUrl: message }
  if (keyPages.some(names)) return { pages: message }
  return { form: message }
}

const withoutError = (errors: Errors, key: keyof Errors): Errors =>
  Object.fromEntries(Object.entries(errors).filter(([name]) => name !== key))

type Errors = { startUrl?: string; pages?: string; scenarios?: string; form?: string }

/** Keyed by the address: a cached copy of this page is shown first, and the form must start over once the saved address arrives. */
function NewAudit() {
  const { site } = Route.useLoaderData()
  return <NewAuditForm key={site.origin} />
}

function NewAuditForm() {
  const { site, lastConfig, baseline, carryOver } = Route.useLoaderData()
  const { start: startPath } = Route.useSearch()
  const timeZone = useTimeZone()
  const router = useRouter()
  const last = Option.getOrNull(decodeConfig(lastConfig))
  const [copied, setCopied] = useState(last !== null)
  const [startUrl, setStartUrl] = useState(() => {
    if (last === null)
      return startPath === undefined ? site.origin : resolveOnSite(startPath, site.origin)
    const first = last.pages[0] ?? ""
    return isOnSite(first, site) ? onSiteScheme(first, site) : site.origin
  })
  const [pages, setPages] = useState(
    last?.pages
      .slice(1)
      .filter((page) => isOnSite(page, site))
      .map((page) => onSiteScheme(page, site))
      .join("\n") ?? "",
  )
  const [scenarios, setScenarios] = useState<ReadonlyArray<Scenario>>(
    last?.scenarios ?? DEFAULT_SCENARIOS,
  )
  const [viewports, setViewports] = useState<ReadonlyArray<"desktop" | "mobile">>(
    last?.viewports ?? ["desktop"],
  )
  const [clickIds, setClickIds] = useState(last?.clickIds ?? false)
  const [journey, setJourney] = useState(last?.journey ?? false)
  const [reload, setReload] = useState(last?.reload ?? false)
  const [crossHost, setCrossHost] = useState(
    site.measuredHosts.length > 0 && (last?.crossHost ?? false),
  )
  const [blockVendorRequests, setBlockVendorRequests] = useState(last?.blockVendorRequests ?? true)
  const [errors, setErrors] = useState<Errors>({})
  const [pending, setPending] = useState(false)
  const hydrated = useHydrated()
  const startRef = useRef<HTMLInputElement>(null)
  const keyPagesRef = useRef<HTMLTextAreaElement>(null)

  function reset() {
    setCopied(false)
    setStartUrl(site.origin)
    setPages("")
    setScenarios(DEFAULT_SCENARIOS)
    setViewports(["desktop"])
    setClickIds(false)
    setJourney(false)
    setReload(false)
    setCrossHost(false)
    setBlockVendorRequests(true)
    setErrors({})
  }

  const start = startUrl.trim()
  const startError = start === "" ? "Enter the page the audit starts from." : urlError(start, site)
  const seen = new Set(startError === undefined ? [new URL(start).href] : [])
  const pageLines = pages
    .split("\n")
    .map((line, index) => {
      const raw = line.trim()
      const value = resolveOnSite(raw, startError === undefined ? start : site.origin)
      let error = raw === "" ? undefined : keyPageError(value, site)
      if (raw !== "" && error === undefined) {
        const href = new URL(value).href
        if (seen.has(href)) error = "Duplicate URL. Each page is opened once."
        seen.add(href)
      }
      return { raw, value: raw === "" ? "" : value, line: index + 1, error }
    })
    .filter((line) => line.value !== "")
  const keyPages = pageLines.filter((line) => line.error === undefined).map((line) => line.value)
  const pageErrors = pageLines.filter((line) => line.error !== undefined)
  const breakdown = runBreakdown({
    pages: startError === undefined ? 1 + keyPages.length : keyPages.length,
    scenarios: scenarios.length,
    viewports: viewports.length,
    journeySteps:
      journey && startError === undefined
        ? Math.min(keyPages.length, JOURNEY_STEPS) + (reload ? 1 : 0)
        : 0,
    crossHostRuns: crossHost && startError === undefined ? site.measuredHosts.length : 0,
  })
  const reloadTarget = keyPages[Math.min(keyPages.length, JOURNEY_STEPS) - 1]
  const scenarioReason = scenarios.length === 0 ? "Choose at least one scenario." : undefined
  const disabledReason =
    scenarioReason ?? (viewports.length === 0 ? "Choose at least one viewport." : undefined)
  const pageLimitError =
    pageLines.length > MAX_KEY_PAGES
      ? `At most ${MAX_KEY_PAGES} key pages (${pageLines.length} entered).`
      : undefined
  const resolvedPages = pageLines.filter(
    (line) => line.error === undefined && line.raw !== line.value,
  )
  const lineErrors =
    pageErrors.length > 0 ? (
      <ul className="space-y-1">
        {pageErrors.map((line) => (
          <li key={line.line}>
            Line {line.line}: {line.error}
          </li>
        ))}
      </ul>
    ) : undefined
  const keyPagesError =
    errors.pages !== undefined || pageLimitError !== undefined || lineErrors !== undefined ? (
      <>
        {errors.pages ?? pageLimitError}
        {lineErrors}
      </>
    ) : undefined

  function toggleScenario(scenario: Scenario, checked: boolean) {
    setScenarios(
      SCENARIOS.map((s) => s.value).filter((value) =>
        value === scenario ? checked : scenarios.includes(value),
      ),
    )
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const found: Errors = {}
    if (startError !== undefined) found.startUrl = startError

    if (disabledReason !== undefined) found.form = disabledReason
    setErrors(found)
    const pagesBlocked = pageErrors.length > 0 || pageLimitError !== undefined
    if (pagesBlocked) keyPagesRef.current?.focus()
    if (Object.keys(found).length > 0 || pagesBlocked) return

    setPending(true)
    const result = await startAudit({
      data: {
        siteId: site.id,
        config: {
          pages: [start, ...keyPages],
          scenarios,
          viewports,
          clickIds,
          blockVendorRequests,
          journey,
          reload: journey && reload,
          crossHost,
        },
      },
    })
    if (result.ok) {
      await router.navigate({
        to: "/app/audits/$auditId",
        params: { auditId: result.value.auditId },
      })
      return
    }
    setPending(false)
    const failed = errorFor(result.message, start, keyPages)
    setErrors(failed)
    if (failed.startUrl !== undefined) startRef.current?.focus()
  }

  return (
    <PageContainer>
      <PageHeader
        title="New audit"
        breadcrumb={[
          { label: site.name, to: "/app/sites/$siteId", params: { siteId: site.id } },
          { label: "New audit" },
        ]}
        description={
          <>
            Every page is opened per scenario and viewport. Pages must be on{" "}
            <code>{originHost(site.origin)}</code>.
          </>
        }
        actions={last === null ? <SampleReportLink /> : undefined}
      />
      {baseline !== null && (
        <p className="text-sm text-muted-foreground">
          Compared with the audit of {shortDate(baseline.createdAt, timeZone)}.{" "}
          {carryOver === null
            ? ""
            : carryOverText(carryOver, shortDate(baseline.createdAt, timeZone))}
        </p>
      )}
      {copied && (
        <p
          role="status"
          className="flex flex-wrap items-center gap-x-3 rounded-md border bg-muted/40 px-3 py-1 text-sm"
        >
          Settings copied from your last audit.
          <Button type="button" size="sm" variant="link" className="px-0" onClick={reset}>
            Reset to defaults
          </Button>
        </p>
      )}
      <form
        onSubmit={submit}
        className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]"
        noValidate
      >
        <fieldset disabled={!hydrated} className="contents">
          <div className="min-w-0 space-y-6">
            <FormSection
              number={1}
              title="Pages"
              help="Choose the landing page and key pages to check."
            >
              <Field
                id="start-url"
                label="Start URL"
                error={errors.startUrl ?? (start !== "" ? startError : undefined)}
                help="The landing page. The site's address by default."
              >
                {(aria) => (
                  <Input
                    id="start-url"
                    ref={startRef}
                    value={startUrl}
                    onChange={(event) => {
                      setStartUrl(event.target.value)
                      setErrors((current) => withoutError(current, "startUrl"))
                    }}
                    className="font-mono text-sm"
                    autoComplete="off"
                    {...aria}
                  />
                )}
              </Field>
              <Field
                id="key-pages"
                label="Key pages"
                error={keyPagesError}
                help={`Pages where tracking matters: product, cart, checkout, thank-you. One URL or path such as /checkout per line, ${keyPages.length} of ${MAX_KEY_PAGES}${pageErrors.length > 0 ? `, ${pageErrors.length} to fix` : ""}.`}
              >
                {(aria) => (
                  <Textarea
                    id="key-pages"
                    ref={keyPagesRef}
                    value={pages}
                    onChange={(event) => {
                      setPages(event.target.value)
                      setErrors((current) => withoutError(current, "pages"))
                    }}
                    rows={5}
                    placeholder={`For example:\n/product\n${site.origin}/checkout`}
                    className="font-mono text-sm"
                    {...aria}
                  />
                )}
              </Field>
              {resolvedPages.length > 0 && (
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {resolvedPages.map((line) => (
                    <li key={line.line} className="wrap-anywhere">
                      <span className="font-mono">{line.raw}</span> opens{" "}
                      <span className="font-mono">{line.value}</span>
                    </li>
                  ))}
                </ul>
              )}
            </FormSection>
            <FormSection
              number={2}
              title="Scenarios and viewports"
              help="Which consent choices to try, on which screen sizes."
            >
              <fieldset
                className="space-y-2"
                aria-describedby={errors.scenarios === undefined ? undefined : "scenarios-error"}
              >
                <legend className="flex items-center gap-1 text-sm font-medium">
                  Consent scenarios
                  <ScenarioHelp />
                </legend>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">Presets</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setScenarios(SCENARIOS.map((scenario) => scenario.value))}
                  >
                    All four
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    title="Just the reject scenario: the quickest check that refusing stops the tags"
                    onClick={() => setScenarios(["reject"])}
                  >
                    Reject only
                  </Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  {SCENARIOS.map((scenario) => (
                    <label
                      key={scenario.value}
                      className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm ${scenarios.includes(scenario.value) ? "border-primary bg-primary/5" : "hover:bg-accent"}`}
                    >
                      <Checkbox
                        checked={scenarios.includes(scenario.value)}
                        onCheckedChange={(checked) =>
                          toggleScenario(scenario.value, checked === true)
                        }
                        className="mt-0.5"
                      />
                      <span>
                        <span className="font-medium">{scenario.label}</span>
                        <span className="block text-xs text-muted-foreground">{scenario.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <FieldError id="scenarios-error" message={errors.scenarios} />
              </fieldset>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Viewport</legend>
                <ToggleGroup
                  type="multiple"
                  variant="outline"
                  value={[...viewports]}
                  onValueChange={(values) =>
                    setViewports(VIEWPORTS.filter((value) => values.includes(value)))
                  }
                  aria-label="Viewports"
                >
                  <ToggleGroupItem value="desktop">Desktop</ToggleGroupItem>
                  <ToggleGroupItem value="mobile">Mobile</ToggleGroupItem>
                </ToggleGroup>
              </fieldset>
            </FormSection>
            <FormSection
              number={3}
              title="Options"
              help="Simulate an ad click or follow a journey in one session."
            >
              <div className="space-y-3">
                <Toggle
                  label="Simulate an ad click"
                  help="Click IDs (gclid, fbclid, ttclid) are the codes ad platforms add to a link when someone clicks an ad. This adds test ones and UTMs to the start URL, to check that the site keeps them and tags receive them."
                  checked={clickIds}
                  onChange={setClickIds}
                />
                <Toggle
                  label="Also walk through the key pages as a journey"
                  help={`A journey opens the start URL, then the first ${JOURNEY_STEPS} key pages in order, in one browser session, like a visitor would, so cookies carry over. Adds one run per scenario and viewport; needs at least one key page.`}
                  checked={journey}
                  onChange={setJourney}
                />
                {journey && (
                  <Toggle
                    label="Reload the last page after the journey"
                    help={`Reloads ${reloadTarget === undefined ? "the last page the journey visits" : `${withoutCredentials(reloadTarget)}, the last page the journey visits`}, to see whether the visitor's consent choice survives a reload.${keyPages.length > JOURNEY_STEPS ? ` The journey stops after ${JOURNEY_STEPS} key pages; the rest are not visited.` : ""} Adds one page load to each journey run.`}
                    checked={reload}
                    onChange={setReload}
                  />
                )}
                {journey && (
                  <div className="space-y-2 rounded-md border p-3">
                    <p className="text-sm font-medium">Journey path</p>
                    {keyPages.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        Add a key page to include journey runs.
                      </p>
                    )}
                    <ol className="list-inside list-decimal space-y-2 text-xs">
                      <li className="wrap-anywhere font-mono">
                        {withoutCredentials(start) || "Start URL"}
                      </li>
                      {keyPages.map((page, index) => (
                        <li
                          key={page}
                          className={`wrap-anywhere ${index >= JOURNEY_STEPS ? "text-muted-foreground" : ""}`}
                        >
                          <span className="font-mono">{withoutCredentials(page)}</span>
                          {index >= JOURNEY_STEPS && (
                            <Badge variant="outline" className="ml-2">
                              not walked
                            </Badge>
                          )}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                {site.measuredHosts.length > 0 && (
                  <Toggle
                    label="Also follow links to the site's other hosts"
                    help={`Opens the start URL, accepts the banner, then clicks a link to ${site.measuredHosts.join(", ")} to see whether consent and the visitor's analytics identity carry over. Adds one accept run per host (${site.measuredHosts.length}), using the first selected viewport.`}
                    checked={crossHost}
                    onChange={setCrossHost}
                  />
                )}
                <Collapsible>
                  <CollapsibleTrigger className="-my-1.5 py-1.5 text-sm font-medium underline-offset-4 hover:underline">
                    Advanced
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-3">
                    <Toggle
                      label="Answer tracking requests locally"
                      help={`${LOCAL_ANSWER_SENTENCE} The requests are still recorded and checked, except whether the vendor accepted them.`}
                      checked={blockVendorRequests}
                      onChange={setBlockVendorRequests}
                    />
                  </CollapsibleContent>
                </Collapsible>
              </div>
            </FormSection>
            <FieldError message={errors.form} />
          </div>
          <aside
            className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t bg-background py-3 lg:top-6 lg:block lg:space-y-3 lg:rounded-lg lg:border lg:bg-card lg:p-4"
            aria-label="Audit estimate"
          >
            <div aria-live="polite" data-testid="estimate">
              <p className="text-base font-semibold tabular-nums lg:text-2xl">
                {breakdown.runs} {breakdown.runs === 1 ? "run" : "runs"}
                <span className="font-normal text-muted-foreground lg:hidden">
                  {" · "}
                  {breakdown.runs === 0 ? "none yet" : breakdown.duration}
                </span>
              </p>
              <p className="hidden text-sm text-muted-foreground lg:block">
                {breakdown.runs === 0 ? "No runs yet" : breakdown.duration}
              </p>
            </div>
            <ul className="hidden space-y-2 font-mono text-xs lg:block text-muted-foreground tabular-nums">
              {breakdown.lines.map((line) => (
                <li key={line.label}>
                  {line.label} = {count(line.runs, "run")}
                </li>
              ))}
            </ul>
            {journey && keyPages.length > 0 && (
              <p className="hidden text-xs text-muted-foreground lg:block">
                A journey run takes as long as{" "}
                {1 + Math.min(keyPages.length, JOURNEY_STEPS) + (reload ? 1 : 0)} page runs.
              </p>
            )}
            {blockVendorRequests && breakdown.runs > 0 && (
              <p
                className="hidden text-xs text-muted-foreground lg:block"
                data-testid="local-answer"
              >
                {LOCAL_ANSWER_SENTENCE}
              </p>
            )}
            {breakdown.runs > 100 && (
              <p className="text-sm text-sev-warning">
                Over 100 runs. Fewer pages or scenarios will shorten this audit.
              </p>
            )}
            <Button
              type="submit"
              className="h-10 shrink-0 lg:w-full"
              disabled={pending || !hydrated || disabledReason !== undefined}
              aria-describedby={disabledReason === undefined ? undefined : "submit-reason"}
            >
              {pending ? "Checking the start page..." : "Start audit"}
            </Button>
            {disabledReason !== undefined && (
              <p id="submit-reason" className="w-full text-xs text-muted-foreground">
                {disabledReason}
              </p>
            )}
            <Collapsible className="hidden lg:block">
              <CollapsibleTrigger className="-my-2 py-2 text-xs text-muted-foreground underline-offset-4 hover:underline">
                How is this estimated?
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2 text-xs text-muted-foreground">
                A page run takes about 7 seconds. Journey runs include the start page and each
                walked page: {breakdown.workUnits} page-run equivalents × 7 seconds. Once the audit
                is running, the time left is recalculated from how fast it actually goes.
              </CollapsibleContent>
            </Collapsible>
          </aside>
        </fieldset>
      </form>
    </PageContainer>
  )
}

function ScenarioHelp() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="What the scenarios mean">
          <CircleHelp />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-2 text-xs">
        <p>
          Each scenario loads the page with a different consent choice, then records what fires.
        </p>
        <dl className="space-y-2">
          {SCENARIOS.map((scenario) => (
            <div key={scenario.value}>
              <dt className="font-medium">{scenario.label}</dt>
              <dd className="text-muted-foreground">{scenario.hint}</dd>
            </div>
          ))}
        </dl>
        <p className="text-muted-foreground">
          Run all four to compare what fires before a choice, after accepting and after rejecting.
        </p>
      </PopoverContent>
    </Popover>
  )
}

function FormSection({
  number,
  title,
  help,
  children,
}: {
  number: number
  title: string
  help: string
  children: ReactNode
}) {
  return (
    <section className="grid min-w-0 gap-4 border-t pt-8 lg:grid-cols-[14rem_1fr]">
      <div className="space-y-1">
        <h2 className="flex items-baseline gap-2 text-base font-semibold">
          <span className="text-sm text-muted-foreground tabular-nums">{number}</span>
          {title}
        </h2>
        <p className="text-xs text-muted-foreground">{help}</p>
      </div>
      <div className="min-w-0 space-y-4">{children}</div>
    </section>
  )
}

function FieldError({ id, message }: { id?: string; message: ReactNode }) {
  return message === undefined ? null : (
    <div id={id} role="alert" className="text-sm text-destructive">
      {message}
    </div>
  )
}

type FieldAria = { "aria-invalid": boolean; "aria-describedby": string }

/** A labelled input with its error and help text; `children` receives the ARIA props that tie them to the input. */
function Field({
  id,
  label,
  help,
  error,
  children,
}: {
  id: string
  label: string
  help: string
  error: ReactNode
  children: (aria: FieldAria) => React.ReactNode
}) {
  const invalid = error !== undefined
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children({
        "aria-invalid": invalid,
        "aria-describedby": invalid ? `${id}-error ${id}-help` : `${id}-help`,
      })}
      <FieldError id={`${id}-error`} message={error} />
      <p id={`${id}-help`} className="text-xs text-muted-foreground">
        {help}
      </p>
    </div>
  )
}

function Toggle({
  label,
  help,
  checked,
  onChange,
}: {
  label: string
  help: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm">
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
        className="mt-0.5"
      />
      <span>
        <span className="font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{help}</span>
      </span>
    </label>
  )
}
