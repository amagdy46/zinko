import { createFileRoute, useRouter } from "@tanstack/react-router"
import { type FormEvent, useState } from "react"
import { toast } from "sonner"
import { Info } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { SettingsSection } from "@/components/settings-section"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { pageTitle } from "@/lib/page-title"
import { formField } from "@/lib/form"
import { getAiPolicy, saveAiPolicy } from "@/server/ai-policy"
import {
  clearLlmSettings,
  getLlmSettings,
  saveLlmSettings,
  testLlmSettings,
} from "@/server/ai-settings"

export const Route = createFileRoute("/app/settings/ai")({
  head: () => pageTitle("AI", "Settings"),
  loader: async () => {
    const settings = await getLlmSettings()
    return { settings, policy: settings === null ? null : await getAiPolicy() }
  },
  component: AiSettings,
})

const providers = [
  { id: "anthropic", label: "Anthropic", model: "claude-sonnet-5-5" },
  { id: "openai", label: "OpenAI", model: "gpt-5" },
  { id: "openrouter", label: "OpenRouter", model: "anthropic/claude-sonnet-5-5" },
  { id: "ollama", label: "Ollama (OpenAI-compatible)", model: "llama3.2" },
] as const

type ProviderId = (typeof providers)[number]["id"]

const isProviderId = (value: string): value is ProviderId =>
  providers.some((provider) => provider.id === value)

const SENT = [
  "the rule's own text",
  "pages as Page 1, Page 2",
  "destination IDs in a vendor's known format",
  "standard event names",
  "cookie families by label",
  "consent states and timing",
  "counts",
]

const NEVER_SENT = [
  "cookie values",
  "click IDs",
  "full URLs and query strings",
  "parameters",
  "client IDs",
  "request bodies",
  "screenshots",
  "page text",
  "account or profile data",
  "your API key",
]

function Explanations({
  policy,
}: {
  policy: { explanationsEnabled: boolean; includePagePaths: boolean; canManage: boolean }
}) {
  const router = useRouter()
  const [enabled, setEnabled] = useState(policy.explanationsEnabled)
  const [paths, setPaths] = useState(policy.includePagePaths)
  const [saving, setSaving] = useState(false)
  const dirty = enabled !== policy.explanationsEnabled || paths !== policy.includePagePaths

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    const result = await saveAiPolicy({
      data: { explanationsEnabled: enabled, includePagePaths: paths },
    })
    setSaving(false)
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    toast.success("Explanation settings saved")
    await router.invalidate()
  }

  return (
    <SettingsSection
      title="Explanations"
      description="Optional text beside a finding that explains it in plain words. It never changes a verdict, and nothing is sent unless you allow it here."
    >
      <div className="max-w-xl">
        <form onSubmit={save} className="space-y-4">
          <div className="flex items-start gap-3">
            <Checkbox
              id="ai-explanations"
              checked={enabled}
              disabled={!policy.canManage || saving}
              onCheckedChange={(value) => setEnabled(value === true)}
              className="mt-1.5"
            />
            <div className="space-y-1">
              <Label htmlFor="ai-explanations" className="min-h-8">
                Allow AI explanations
              </Label>
              <p className="text-sm text-muted-foreground">
                Off by default. Members can ask for an explanation of a finding once this is on and
                a key is set.
              </p>
            </div>
          </div>
          {enabled ? (
            <div className="space-y-3 rounded-md border p-3 text-sm" data-testid="ai-disclosure">
              <p>
                When someone asks for an explanation, a reduced summary of the finding is sent to
                the provider you configured above. Aliasing and redaction lower the exposure; they
                are not a guarantee.
              </p>
              <div>
                <p className="font-medium">Sent</p>
                <p className="text-muted-foreground">{SENT.join(", ")}.</p>
              </div>
              <div>
                <p className="font-medium">Never sent</p>
                <p className="text-muted-foreground">{NEVER_SENT.join(", ")}.</p>
              </div>
              {paths ? (
                <div>
                  <p className="font-medium">Page paths are on</p>
                  <p className="text-muted-foreground">
                    Paths are sent as you wrote them and may contain personal data such as names,
                    emails or tokens.
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="flex items-start gap-3">
            <Checkbox
              id="ai-paths"
              checked={paths}
              disabled={!policy.canManage || saving}
              onCheckedChange={(value) => setPaths(value === true)}
              className="mt-1.5"
            />
            <div className="space-y-1">
              <Label htmlFor="ai-paths" className="min-h-8">
                Include page paths in explanations
              </Label>
              <p className="text-sm text-muted-foreground">
                Off by default. Pages are sent as Page 1, Page 2. If you turn this on, the path you
                entered for each page is sent without its query string, exactly as written. Paths
                are not checked and may contain personal data such as names, emails or tokens, so
                check yours first.
              </p>
            </div>
          </div>
          {policy.canManage ? (
            <Button type="submit" disabled={!dirty || saving}>
              {saving ? "Saving…" : "Save explanation options"}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              Ask an owner or admin of this organization to change these settings.
            </p>
          )}
        </form>
      </div>
    </SettingsSection>
  )
}

function AiSettings() {
  const { settings, policy } = Route.useLoaderData()
  const router = useRouter()
  const [pending, setPending] = useState<"save" | "test" | "remove" | null>(null)
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null)
  const [typedKey, setTypedKey] = useState("")
  const [provider, setProvider] = useState<ProviderId>(
    settings?.provider !== null &&
      settings?.provider !== undefined &&
      isProviderId(settings.provider)
      ? settings.provider
      : "anthropic",
  )

  if (settings === null)
    return <p className="text-sm text-muted-foreground">Select an organization to set up AI.</p>

  const { canManage, configured, last4 } = settings
  const needsUrl = provider === "ollama" || provider === "openai"

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    setPending("save")
    setFeedback(null)
    const result = await saveLlmSettings({
      data: {
        provider,
        model: formField(data, "model"),
        apiKey: formField(data, "apiKey"),
        baseUrl: formField(data, "baseUrl"),
      },
    })
    setPending(null)
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    form.reset()
    setTypedKey("")
    toast.success("AI provider saved")
    await router.invalidate()
  }

  async function test() {
    setPending("test")
    setFeedback(null)
    const result = await testLlmSettings()
    setPending(null)
    setFeedback({
      ok: result.ok,
      message: result.ok ? `The model answered: ${result.value}` : result.message,
    })
  }

  async function clear() {
    setPending("remove")
    setFeedback(null)
    const result = await clearLlmSettings()
    setPending(null)
    if (!result.ok) toast.error(result.message)
    else toast.success("API key removed")
    await router.invalidate()
  }

  return (
    <div className="space-y-6">
      <SettingsSection
        title="AI provider"
        description="Bring your own key. It is encrypted before it is stored and never sent back to the browser."
      >
        <div className="max-w-xl space-y-4">
          {configured ? (
            <p className="text-sm" data-testid="ai-status">
              <span className="font-medium">{settings.provider}</span> ·{" "}
              <span className="font-mono break-all">{settings.model}</span>
              {last4 === null ? (
                ""
              ) : (
                <>
                  {" "}
                  <code className="font-mono">•••• {last4}</code>
                </>
              )}
            </p>
          ) : (
            <div
              className="flex items-start gap-2 rounded-md border p-3 text-sm text-muted-foreground"
              data-testid="ai-status"
            >
              <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <p>
                No key is set for this organization. Without a key, findings show the built-in fix
                steps.
              </p>
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            Rules decide pass or fail; the model only writes explanations.
          </p>
          {feedback === null ? null : (
            <p
              role={feedback.ok ? "status" : "alert"}
              className={feedback.ok ? "text-sm text-status-pass" : "text-sm text-destructive"}
            >
              {feedback.message}
            </p>
          )}
          {canManage ? (
            <form onSubmit={save} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="ai-provider">Provider</Label>
                <Select
                  value={provider}
                  disabled={pending !== null}
                  onValueChange={(value) => {
                    if (isProviderId(value)) setProvider(value)
                  }}
                >
                  <SelectTrigger id="ai-provider" className="w-full">
                    <SelectValue>{providers.find((p) => p.id === provider)?.label}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {providers.map(({ id, label }) => (
                      <SelectItem key={id} value={id}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ai-model">Model</Label>
                <Input
                  id="ai-model"
                  name="model"
                  required
                  defaultValue={settings.model ?? undefined}
                  placeholder={providers.find((p) => p.id === provider)?.model}
                  key={provider}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ai-key">{configured ? "New API key" : "API key"}</Label>
                <Input
                  id="ai-key"
                  name="apiKey"
                  type="password"
                  autoComplete="new-password"
                  value={typedKey}
                  onChange={(event) => setTypedKey(event.target.value)}
                  placeholder={configured ? "Leave empty to keep the current key" : "sk-..."}
                />
              </div>
              {needsUrl ? (
                <div className="space-y-2">
                  <Label htmlFor="ai-base-url">Base URL</Label>
                  <Input
                    id="ai-base-url"
                    name="baseUrl"
                    type="url"
                    defaultValue={settings.baseUrl ?? undefined}
                    placeholder={
                      provider === "ollama"
                        ? "http://localhost:11434/v1"
                        : "https://api.openai.com/v1"
                    }
                  />
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  disabled={pending !== null || (!configured && typedKey.trim() === "")}
                >
                  {pending === "save" ? "Saving…" : "Save provider"}
                </Button>
                {configured ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={pending !== null}
                      onClick={test}
                    >
                      {pending === "test" ? "Testing…" : "Test"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={pending !== null}
                      onClick={clear}
                    >
                      {pending === "remove" ? "Removing…" : "Remove key"}
                    </Button>
                  </>
                ) : null}
              </div>
              {!configured && typedKey.trim() === "" ? (
                <p className="text-xs text-muted-foreground">Enter an API key to save.</p>
              ) : null}
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">
              Ask an owner or admin of this organization to change these settings.
            </p>
          )}
        </div>
      </SettingsSection>
      {policy === null ? null : <Explanations policy={policy} />}
    </div>
  )
}
