import { NotFound } from "@/components/not-found"
import type { Scenario } from "@repo/capture-contract"
import { AuditConfig, JOURNEY_STEPS } from "@repo/core/audit"
import { createFileRoute, useRouter } from "@tanstack/react-router"
import { Option, Schema } from "effect"
import { CircleHelp } from "lucide-react"
import { type FormEvent, type ReactNode, useRef, useState } from "react"
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
import { runBreakdown, SCENARIOS } from "@/lib/audit-labels"
import { count } from "@/lib/format"
import { isOnSite, onSiteScheme, originHost, withoutCredentials } from "@/lib/site-url"
import { startAudit } from "@/server/audits"
import { getSite } from "@/server/clients"

export const Route = createFileRoute("/app/sites/$siteId_/audits/new")({
  loader: ({ params }) => getSite({ data: { id: params.siteId } }),
  notFoundComponent: () => <NotFound what="Site" />,
  component: NewAudit,
})

const MAX_KEY_PAGES = 19
const DEFAULT_SCENARIOS: ReadonlyArray<Scenario> = ["none", "accept", "reject"]
const decodeConfig = Schema.decodeUnknownOption(AuditConfig)

const VIEWPORTS = ["desktop", "mobile"] as const

type SiteScope = { host: string; origin: string }

const urlError = (value: string, site: SiteScope) => {
  if (!URL.canParse(value)) return "Enter a valid URL."
  if (!isOnSite(value, site))
    return `Use an http(s) URL on ${originHost(site.origin)}, without a username or password.`
  return undefined
}

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
  const { site, lastConfig } = Route.useLoaderData()
  const router = useRouter()
  const last = Option.getOrNull(decodeConfig(lastConfig))
  const [copied, setCopied] = useState(last !== null)
  const [startUrl, setStartUrl] = useState(
    last !== null && isOnSite(last.pages[0] ?? "", site)
      ? onSiteScheme(last.pages[0] ?? site.origin, site)
      : site.origin,
  )
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
  const [blockVendorRequests, setBlockVendorRequests] = useState(last?.blockVendorRequests ?? true)
  const [errors, setErrors] = useState<Errors>({})
  const [pending, setPending] = useState(false)
  const startRef = useRef<HTMLInputElement>(null)

  function reset() {
    setCopied(false)
    setStartUrl(site.origin)
    setPages("")
    setScenarios(DEFAULT_SCENARIOS)
    setViewports(["desktop"])
    setClickIds(false)
    setJourney(false)
    setBlockVendorRequests(true)
    setErrors({})
  }

  const start = startUrl.trim()
  const startError = start === "" ? "Enter the page the audit starts from." : urlError(start, site)
  const seen = new Set(startError === undefined ? [new URL(start).href] : [])
  const pageLines = pages
    .split("\n")
    .map((line, index) => {
      const value = line.trim()
      let error = value === "" ? undefined : urlError(value, site)
      if (value !== "" && error === undefined) {
        const href = new URL(value).href
        if (seen.has(href)) error = "Duplicate URL. Each page is opened once."
        seen.add(href)
      }
      return { value, line: index + 1, error }
    })
    .filter((line) => line.value !== "")
  const keyPages = pageLines.filter((line) => line.error === undefined).map((line) => line.value)
  const pageErrors = pageLines.filter((line) => line.error !== undefined)
  const breakdown = runBreakdown({
    pages: startError === undefined ? 1 + keyPages.length : keyPages.length,
    scenarios: scenarios.length,
    viewports: viewports.length,
    journeySteps:
      journey && startError === undefined ? Math.min(keyPages.length, JOURNEY_STEPS) : 0,
  })
  const scenarioReason = scenarios.length === 0 ? "Choose at least one scenario." : undefined
  const disabledReason =
    scenarioReason ?? (viewports.length === 0 ? "Choose at least one viewport." : undefined)
  const keyPageError = pageErrors.length > 0 ? "Correct the marked lines below." : undefined
  const pageLimitError = pageLines.length > MAX_KEY_PAGES ? "Too many key pages." : undefined

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
    if (pageErrors.length > 0) found.pages = "Correct the marked lines before starting."
    if (pageLines.length > MAX_KEY_PAGES)
      found.pages = `At most ${MAX_KEY_PAGES} key pages (${pageLines.length} entered).`
    if (disabledReason !== undefined) found.form = disabledReason
    setErrors(found)
    if (Object.keys(found).length > 0) return

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
      />
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
              error={errors.pages ?? keyPageError ?? pageLimitError}
              help={`One URL per line. ${pageLines.length} of ${MAX_KEY_PAGES}.`}
            >
              {(aria) => (
                <Textarea
                  id="key-pages"
                  value={pages}
                  onChange={(event) => {
                    setPages(event.target.value)
                    setErrors((current) => withoutError(current, "pages"))
                  }}
                  rows={5}
                  placeholder={`${site.origin}/product\n${site.origin}/checkout`}
                  className="font-mono text-sm"
                  {...aria}
                />
              )}
            </Field>
            {pageErrors.length > 0 && (
              <ul className="space-y-1 text-xs text-destructive" aria-live="polite">
                {pageErrors.map((line) => (
                  <li key={line.line}>
                    Line {line.line}: {line.error}
                  </li>
                ))}
              </ul>
            )}
          </FormSection>
          <FormSection
            number={2}
            title="Scenarios and viewports"
            help="Compare consent choices across screen sizes."
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
              <Collapsible>
                <CollapsibleTrigger className="-my-1.5 py-1.5 text-sm font-medium underline-offset-4 hover:underline">
                  Advanced
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3">
                  <Toggle
                    label="Answer tracking requests locally"
                    help="Tracking requests get a made-up reply instead of reaching the vendor, so test visits stay out of the client's analytics. They are still recorded and checked."
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
              A journey run takes as long as {1 + Math.min(keyPages.length, JOURNEY_STEPS)} page
              runs.
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
            disabled={pending || disabledReason !== undefined}
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
              A page run takes about 7 seconds. Journey runs include the start page and each walked
              page: {breakdown.workUnits} page-run equivalents × 7 seconds. Once the audit is
              running, the time left is recalculated from how fast it actually goes.
            </CollapsibleContent>
          </Collapsible>
        </aside>
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

function FieldError({ id, message }: { id?: string; message: string | undefined }) {
  return message === undefined ? null : (
    <p id={id} role="alert" className="text-sm text-destructive">
      {message}
    </p>
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
  error: string | undefined
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
