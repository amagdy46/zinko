import { createFileRoute, useRouter } from "@tanstack/react-router"
import { type FormEvent, useState } from "react"
import { toast } from "sonner"
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

const selectClass =
  "h-9 w-full rounded-md border bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"

const isProviderId = (value: string): value is ProviderId =>
  providers.some((provider) => provider.id === value)

async function test() {
  const result = await testLlmSettings()
  if (result.ok) toast.success(`The model answered: ${result.value}`)
  else toast.error(result.message)
}

function AiSettings() {
  const settings = Route.useLoaderData()
  const router = useRouter()
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
    const result = await saveLlmSettings({
      data: {
        provider,
        model: formField(data, "model"),
        apiKey: formField(data, "apiKey"),
        baseUrl: formField(data, "baseUrl"),
      },
    })
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    form.reset()
    toast.success("AI settings saved")
    await router.invalidate()
  }

  async function clear() {
    const result = await clearLlmSettings()
    if (!result.ok) toast.error(result.message)
    else toast.success("API key removed")
    await router.invalidate()
  }

  return (
    <Card className="max-w-xl">
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
            Using {settings.provider} / {settings.model}
            {last4 === null ? (
              ""
            ) : (
              <>
                {" "}
                with the key ending in <code>{last4}</code>
              </>
            )}
            .
          </p>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="ai-status">
            No key is set for this organization yet.
          </p>
        )}
        {canManage ? (
          <form onSubmit={save} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ai-provider">Provider</Label>
              <select
                id="ai-provider"
                className={selectClass}
                value={provider}
                onChange={(event) => {
                  if (isProviderId(event.target.value)) setProvider(event.target.value)
                }}
              >
                {providers.map(({ id, label }) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
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
              <Label htmlFor="ai-key">API key</Label>
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
            <div className="flex gap-2">
              <Button type="submit">Save</Button>
              {configured ? (
                <>
                  <Button type="button" variant="outline" onClick={test}>
                    Test
                  </Button>
                  <Button type="button" variant="outline" onClick={clear}>
                    Remove key
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
