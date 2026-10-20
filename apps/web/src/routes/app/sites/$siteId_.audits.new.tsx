import type { Scenario } from "@repo/capture-contract"
import { AuditConfig } from "@repo/core/audit"
import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { Option, Schema } from "effect"
import { type FormEvent, useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { estimateDuration, SCENARIOS } from "@/lib/audit-labels"
import { withoutCredentials } from "@/lib/site-url"
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

type ViewportChoice = "desktop" | "mobile" | "both"

const VIEWPORTS: ReadonlyArray<{ value: ViewportChoice; label: string }> = [
  { value: "desktop", label: "Desktop" },
  { value: "mobile", label: "Mobile" },
  { value: "both", label: "Both" },
]

const viewportsOf = (choice: ViewportChoice) =>
  choice === "both" ? (["desktop", "mobile"] as const) : ([choice] as const)

const choiceOf = (viewports: ReadonlyArray<string>): ViewportChoice => {
  if (viewports.length > 1) return "both"
  return viewports[0] === "mobile" ? "mobile" : "desktop"
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
  const [viewport, setViewport] = useState<ViewportChoice>(choiceOf(last?.viewports ?? ["desktop"]))
  const [clickIds, setClickIds] = useState(last?.clickIds ?? false)
  const [blockVendorRequests, setBlockVendorRequests] = useState(last?.blockVendorRequests ?? true)
  const [errors, setErrors] = useState<Errors>({})
  const [pending, setPending] = useState(false)

  const start = startUrl.trim()
  const keyPages = [...new Set(pages.split("\n").map((line) => line.trim()))].filter(
    (line) => line !== "" && line !== start,
  )
  const runs =
    (start === "" ? 0 : 1 + keyPages.length) * scenarios.length * viewportsOf(viewport).length

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
    if (start === "") found.startUrl = "Enter the page the audit starts from."
    if (keyPages.length > MAX_KEY_PAGES)
      found.pages = `At most ${MAX_KEY_PAGES} key pages (${keyPages.length} entered).`
    if (scenarios.length === 0) found.scenarios = "Pick at least one scenario."
    setErrors(found)
    if (Object.keys(found).length > 0) return

    setPending(true)
    const result = await startAudit({
      data: {
        siteId: site.id,
        config: {
          pages: [start, ...keyPages],
          scenarios,
          viewports: viewportsOf(viewport),
          clickIds,
          blockVendorRequests,
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
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="flex gap-1 text-sm text-muted-foreground">
          <Link
            to="/app/sites/$siteId"
            params={{ siteId: site.id }}
            className="hover:text-foreground"
          >
            {site.name}
          </Link>
          <span>/</span>
          <span>New audit</span>
        </div>
        <h1 className="text-2xl font-semibold">New audit</h1>
        <p className="text-sm text-muted-foreground">
          Every page is opened once per scenario and viewport. Pages must be on{" "}
          <code>{site.host}</code>.
        </p>
      </div>
      <form onSubmit={submit} className="max-w-2xl space-y-5" noValidate>
        <Field
          id="start-url"
          label="Start URL"
          error={errors.startUrl}
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
          error={errors.pages}
          help={`One URL per line, up to ${MAX_KEY_PAGES}. ${keyPages.length} entered.`}
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
        <fieldset
          className="space-y-2"
          aria-describedby={errors.scenarios === undefined ? undefined : "scenarios-error"}
        >
          <legend className="text-sm font-medium">Consent scenarios</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {SCENARIOS.map((scenario) => (
              <label
                key={scenario.value}
                className="flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent"
              >
                <Checkbox
                  checked={scenarios.includes(scenario.value)}
                  onCheckedChange={(checked) => toggleScenario(scenario.value, checked === true)}
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
          <RadioGroup
            value={viewport}
            onValueChange={(value) => {
              const choice = VIEWPORTS.find((option) => option.value === value)
              if (choice !== undefined) setViewport(choice.value)
            }}
            className="flex gap-4 text-sm"
          >
            {VIEWPORTS.map((option) => (
              <label key={option.value} className="flex cursor-pointer items-center gap-2">
                <RadioGroupItem value={option.value} />
                {option.label}
              </label>
            ))}
          </RadioGroup>
        </fieldset>
        <div className="space-y-3">
          <Toggle
            label="Simulate an ad click"
            help="Adds test click IDs (gclid, fbclid, ttclid) and UTMs to the start URL."
            checked={clickIds}
            onChange={setClickIds}
          />
          <Toggle
            label="Answer tracking requests locally"
            help="Test traffic stays out of the client's analytics."
            checked={blockVendorRequests}
            onChange={setBlockVendorRequests}
          />
        </div>
        <FieldError message={errors.form} />
        <div className="flex items-center gap-4 border-t pt-4">
          <Button type="submit" disabled={pending}>
            {pending ? "Starting..." : "Start audit"}
          </Button>
          <p className="text-sm text-muted-foreground" data-testid="estimate">
            {runs === 0
              ? "No runs yet"
              : `${runs} ${runs === 1 ? "run" : "runs"}, ${estimateDuration(runs)}`}
          </p>
        </div>
      </form>
    </div>
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
