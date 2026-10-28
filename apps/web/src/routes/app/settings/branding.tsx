import { createFileRoute, useRouter } from "@tanstack/react-router"
import { Check, Info } from "lucide-react"
import { type FormEvent, useState } from "react"
import { toast } from "sonner"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ACCENTS, type AccentId, contrastOnWhite } from "@/lib/report-accent"
import { cn } from "@/lib/utils"
import { getBranding, saveBranding } from "@/server/branding"

export const Route = createFileRoute("/app/settings/branding")({
  loader: () => getBranding(),
  component: BrandingSettings,
})

const NAME_MAX = 80
const FOOTER_MAX = 300

type Branding = Awaited<ReturnType<typeof getBranding>>

function CoverPreview({
  agencyName,
  accent,
  footerText,
  showPoweredBy,
}: {
  agencyName: string
  accent: AccentId
  footerText: string
  showPoweredBy: boolean
}) {
  return (
    <div
      data-accent={accent}
      className="report-paper overflow-hidden rounded-md border bg-card text-card-foreground"
    >
      <div className="h-2 bg-report-accent" />
      <div className="space-y-6 p-5">
        <p className="text-sm font-semibold text-report-accent [overflow-wrap:anywhere]">
          {agencyName.trim() === "" ? "Your agency" : agencyName.trim()}
        </p>
        <div>
          <p className="text-xs text-muted-foreground">Tracking audit</p>
          <p className="text-lg font-semibold">Client name</p>
          <p className="text-sm text-muted-foreground">shop.example</p>
        </div>
        <div className="space-y-1 border-t pt-3 text-xs text-muted-foreground">
          {footerText.trim() === "" ? null : (
            <p className="whitespace-pre-line [overflow-wrap:anywhere]">{footerText.trim()}</p>
          )}
          {showPoweredBy ? <p>Powered by Zinko</p> : null}
        </div>
      </div>
    </div>
  )
}

function BrandingForm({ data }: { data: Branding }) {
  const router = useRouter()
  const { branding, canManage } = data
  const [agencyName, setAgencyName] = useState(branding.agencyName)
  const [accent, setAccent] = useState<AccentId>(branding.accent)
  const [footerText, setFooterText] = useState(branding.footerText ?? "")
  const [showPoweredBy, setShowPoweredBy] = useState(branding.showPoweredBy)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty =
    agencyName !== branding.agencyName ||
    accent !== branding.accent ||
    footerText !== (branding.footerText ?? "") ||
    showPoweredBy !== branding.showPoweredBy
  const disabled = !canManage || saving

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    const result = await saveBranding({ data: { agencyName, accent, footerText, showPoweredBy } })
    setSaving(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    toast.success("Branding saved")
    await router.invalidate()
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,36rem)_minmax(0,20rem)]">
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Report branding</CardTitle>
          <CardDescription>
            Clients see this on the cover and in the footer of every report you share.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={save} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="branding-name">Agency name</Label>
              <Input
                id="branding-name"
                value={agencyName}
                disabled={disabled}
                onChange={(event) => setAgencyName(event.target.value)}
                aria-describedby="branding-name-count"
              />
              <p id="branding-name-count" className="text-xs text-muted-foreground">
                {agencyName.trim().length} of {NAME_MAX} characters.
              </p>
            </div>
            <fieldset className="space-y-2" disabled={disabled}>
              <legend className="text-sm font-medium">Accent colour</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {ACCENTS.map(({ id, label }) => (
                  <label key={id} className="relative block">
                    <input
                      type="radio"
                      name="accent"
                      value={id}
                      checked={accent === id}
                      onChange={() => setAccent(id)}
                      className="peer sr-only"
                    />
                    <span
                      data-accent={id}
                      className={cn(
                        "flex min-h-8 flex-col gap-1 rounded-md border p-2 text-sm",
                        "peer-checked:border-report-accent peer-checked:bg-accent",
                        "peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50",
                        "peer-disabled:opacity-60",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-report-accent text-report-on-accent">
                          {accent === id ? <Check aria-hidden="true" className="size-3" /> : null}
                        </span>
                        <span className="font-medium">{label}</span>
                      </span>
                      <span className="text-2xs text-muted-foreground">
                        {contrastOnWhite(id).toFixed(1)}:1 on white
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Every preset reads at 4.5:1 or better against white, so the report stays legible.
              </p>
            </fieldset>
            <div className="space-y-2">
              <Label htmlFor="branding-footer">Footer text</Label>
              <Textarea
                id="branding-footer"
                value={footerText}
                disabled={disabled}
                onChange={(event) => setFooterText(event.target.value)}
                placeholder="Contact details or a confidentiality line"
                aria-describedby="branding-footer-count"
              />
              <p id="branding-footer-count" className="text-xs text-muted-foreground">
                Plain text, printed as typed. {footerText.trim().length} of {FOOTER_MAX} characters.
              </p>
            </div>
            <div className="flex items-start gap-3">
              <Checkbox
                id="branding-powered"
                checked={showPoweredBy}
                disabled={disabled}
                onCheckedChange={(value) => setShowPoweredBy(value === true)}
                className="mt-1.5"
              />
              <div className="space-y-1">
                <Label htmlFor="branding-powered" className="min-h-8">
                  Show &ldquo;Powered by Zinko&rdquo;
                </Label>
                <p className="text-sm text-muted-foreground">
                  A small line in the footer of the report.
                </p>
              </div>
            </div>
            {data.personalData ? (
              <Alert>
                <Info aria-hidden="true" />
                <AlertDescription>
                  The name or footer contains what looks like an email address or phone number.
                  Reports print this text exactly as typed.
                </AlertDescription>
              </Alert>
            ) : null}
            {error === null ? null : (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {canManage ? (
              <Button type="submit" disabled={!dirty || saving}>
                {saving ? "Saving…" : "Save branding"}
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                Ask an owner or admin of this organization to change the branding.
              </p>
            )}
          </form>
        </CardContent>
      </Card>
      <div className="space-y-2">
        <h2 className="text-sm font-medium">Cover preview</h2>
        <CoverPreview
          agencyName={agencyName}
          accent={accent}
          footerText={footerText}
          showPoweredBy={showPoweredBy}
        />
      </div>
    </div>
  )
}

function BrandingSettings() {
  const data = Route.useLoaderData()
  return <BrandingForm key={JSON.stringify(data.branding)} data={data} />
}
