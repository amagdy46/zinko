import type { Scenario } from "@repo/capture-contract"
import { AuditConfig, JOURNEY_STEPS } from "@repo/core/audit"
import { createFileRoute, useRouter } from "@tanstack/react-router"
import { Option, Schema } from "effect"
import { type FormEvent, type ReactNode, useState } from "react"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { runBreakdown, SCENARIOS } from "@/lib/audit-labels"
import { isOnSite, withoutCredentials } from "@/lib/site-url"
import { startAudit } from "@/server/audits"
import { getSite } from "@/server/clients"

export const Route = createFileRoute("/app/sites/$siteId_/audits/new")({
  loader: ({ params }) => getSite({ data: { id: params.siteId } }),
  notFoundComponent: () => <p className="text-sm text-muted-foreground">Site not found.</p>,
  component: NewAudit,
})

const MAX_KEY_PAGES = 19
const DEFAULT_SCENARIOS: ReadonlyArray<Scenario> = ["none", "accept", "reject"]
const decodeConfig = Schema.decodeUnknownOption(AuditConfig)

const VIEWPORTS = ["desktop", "mobile"] as const

const urlError = (value: string, host: string) => {
  if (!URL.canParse(value)) return "Enter a valid URL."
  if (!isOnSite(value, host)) return `Use an http(s) URL on ${host} without credentials.`
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

type Errors = { startUrl?: string; pages?: string; scenarios?: string; form?: string }

function NewAudit() {
  const { site, lastConfig } = Route.useLoaderData()
  const router = useRouter()
  const last = Option.getOrNull(decodeConfig(lastConfig))
  const [startUrl, setStartUrl] = useState(last?.pages[0] ?? site.origin)
  const [pages, setPages] = useState(last?.pages.slice(1).join("\n") ?? "")
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

  const start = startUrl.trim()
  const startError =
    start === "" ? "Enter the page the audit starts from." : urlError(start, site.host)
  const seen = new Set(startError === undefined ? [new URL(start).href] : [])
  const pageLines = pages
    .split("\n")
    .map((line, index) => {
      const value = line.trim()
      let error = value === "" ? undefined : urlError(value, site.host)
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
    setErrors(errorFor(result.message, start, keyPages))
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="New audit"
        breadcrumb={[
          { label: site.name, to: "/app/sites/$siteId", params: { siteId: site.id } },
          { label: "New audit" },
        ]}
        description={
          <>
            Every page is opened per scenario and viewport. Pages must be on{" "}
            <code>{site.host}</code>.
          </>
        }
      />
      <form
        onSubmit={submit}
        className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]"
        noValidate
      >
        <div className="min-w-0 space-y-6">
          <FormSection title="Pages" help="Choose the landing page and key pages to check.">
            <Field
              id="start-url"
              label="Start URL"
              error={errors.startUrl ?? (start !== "" ? startError : undefined)}
              help="The landing page. The site's address by default."
            >
              {(aria) => (
                <Input
                  id="start-url"
                  value={startUrl}
                  onChange={(event) => setStartUrl(event.target.value)}
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
                  onChange={(event) => setPages(event.target.value)}
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
            title="Scenarios and viewports"
            help="Compare consent choices across screen sizes."
          >
            <fieldset
              className="space-y-2"
              aria-describedby={errors.scenarios === undefined ? undefined : "scenarios-error"}
            >
              <legend className="text-sm font-medium">Consent scenarios</legend>
              <div className="flex gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setScenarios(SCENARIOS.map((scenario) => scenario.value))}
                >
                  All
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setScenarios(["reject"])}
                >
                  Only reject
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
            title="Options"
            help="Simulate an ad click or follow a journey in one session."
          >
            <div className="space-y-3">
              <Toggle
                label="Simulate an ad click"
                help="Adds test click IDs (gclid, fbclid, ttclid) and UTMs to the start URL."
                checked={clickIds}
                onChange={setClickIds}
              />
              <Toggle
                label="Also walk through the key pages in one session"
                help={`Adds a run per scenario and viewport that opens the start URL, then the first ${JOURNEY_STEPS} key pages in order, in one browser session so cookies carry over. Only the first ${JOURNEY_STEPS} are walked; needs at least one key page.`}
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
                <CollapsibleTrigger className="text-sm font-medium underline-offset-4 hover:underline">
                  Advanced
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3">
                  <Toggle
                    label="Answer tracking requests locally"
                    help="Test traffic stays out of the client's analytics."
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
          className="sticky bottom-0 z-10 space-y-3 border-t bg-background py-4 lg:top-6 lg:rounded-lg lg:border lg:bg-card lg:p-4"
          aria-label="Audit estimate"
        >
          <div aria-live="polite" data-testid="estimate">
            <p className="text-2xl font-semibold tabular-nums">
              {breakdown.runs} {breakdown.runs === 1 ? "run" : "runs"}
            </p>
            <p className="text-sm text-muted-foreground">
              {breakdown.runs === 0 ? "No runs yet" : breakdown.duration}
            </p>
          </div>
          <ul className="hidden space-y-2 font-mono text-xs lg:block text-muted-foreground tabular-nums">
            {breakdown.lines.map((line) => (
              <li key={line.label}>
                {line.label} = {line.runs} runs
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
            className="w-full"
            disabled={pending || disabledReason !== undefined}
            aria-describedby={disabledReason === undefined ? undefined : "submit-reason"}
          >
            {pending ? "Starting..." : "Start audit"}
          </Button>
          {disabledReason !== undefined && (
            <p id="submit-reason" className="text-xs text-muted-foreground">
              {disabledReason}
            </p>
          )}
          <Collapsible className="hidden lg:block">
            <CollapsibleTrigger className="text-xs text-muted-foreground underline-offset-4 hover:underline">
              How is this estimated?
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2 text-xs text-muted-foreground">
              A page run averages 12.8 seconds. Journey runs include the start page and each walked
              page: {breakdown.workUnits} page-run equivalents × 12.8 seconds. Actual time varies
              with the site.
            </CollapsibleContent>
          </Collapsible>
        </aside>
      </form>
    </div>
  )
}

function FormSection({
  title,
  help,
  children,
}: {
  title: string
  help: string
  children: ReactNode
}) {
  return (
    <section className="grid min-w-0 gap-4 border-t pt-6 lg:grid-cols-[14rem_1fr]">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">{title}</h2>
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
