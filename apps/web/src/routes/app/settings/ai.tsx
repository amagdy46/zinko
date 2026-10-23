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
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formField } from "@/lib/form"
import {
  clearLlmSettings,
  getLlmSettings,
  saveLlmSettings,
  testLlmSettings,
} from "@/server/ai-settings"

export const Route = createFileRoute("/app/settings/ai")({
  loader: () => getLlmSettings(),
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

function AiSettings() {
  const settings = Route.useLoaderData()
  const router = useRouter()
  const [pending, setPending] = useState<"save" | "test" | "remove" | null>(null)
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null)
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
    toast.success("AI settings saved")
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
    <Card className="max-w-xl shadow-none">
      <CardHeader>
        <CardTitle>AI provider</CardTitle>
        <CardDescription>
          Bring your own key. It is encrypted before it is stored and never sent back to the
          browser.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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
            <p>No key is set for this organization. Without a key, fix templates are used.</p>
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
                  <SelectValue />
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
                autoComplete="off"
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
              <Button type="submit" disabled={pending !== null}>
                {pending === "save" ? "Saving…" : "Save settings"}
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
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">
            Ask an owner or admin of this organization to change these settings.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
