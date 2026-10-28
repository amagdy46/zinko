import { createFileRoute, useRouter } from "@tanstack/react-router"
import { Check, Info } from "lucide-react"
import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react"
import { toast } from "sonner"
import { pageTitle } from "@/lib/page-title"
import { SettingsSection } from "@/components/settings-section"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ACCENTS, type AccentId, contrastOnWhite } from "@/lib/report-accent"
import { cn } from "@/lib/utils"
import { getBranding, saveBranding } from "@/server/branding"
import { removeLogo, uploadLogo } from "@/server/branding-logo"

export const Route = createFileRoute("/app/settings/branding")({
  head: () => pageTitle("Branding", "Settings"),
  loader: () => getBranding(),
  component: BrandingSettings,
})

const NAME_MAX = 80
const FOOTER_MAX = 300

type Branding = Awaited<ReturnType<typeof getBranding>>

function CoverPreview({
  agencyName,
  logoUrl,
  accent,
  footerText,
  showPoweredBy,
}: {
  agencyName: string
  logoUrl: string | null
  accent: AccentId
  footerText: string
  showPoweredBy: boolean
}) {
  const name = agencyName.trim() === "" ? "Your agency" : agencyName.trim()
  return (
    <div
      data-accent={accent}
      className="report-paper overflow-hidden rounded-md border bg-card text-card-foreground"
    >
      <div className="h-2 bg-report-accent" />
      <div className="space-y-6 p-5">
        {logoUrl === null ? (
          <p className="text-sm font-semibold text-report-accent [overflow-wrap:anywhere]">
            {name}
          </p>
        ) : (
          <img src={logoUrl} alt={name} className="max-h-14 max-w-40 object-contain" />
        )}
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

function LogoCard({ logoUrl, canManage }: { logoUrl: string | null; canManage: boolean }) {
  const router = useRouter()
  const [pending, setPending] = useState<"upload" | "remove" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refocus, setRefocus] = useState(0)
  const uploadField = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (refocus > 0) uploadField.current?.focus()
  }, [refocus])

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (file === undefined) return
    const form = new FormData()
    form.set("file", file)
    setPending("upload")
    setError(null)
    const result = await uploadLogo({ data: form })
    setPending(null)
    input.value = ""
    setRefocus((n) => n + 1)
    if (!result.ok) {
      setError(result.message)
      return
    }
    toast.success("Logo saved")
    await router.invalidate()
  }

  async function remove() {
    setPending("remove")
    setError(null)
    const result = await removeLogo()
    setPending(null)
    setRefocus((n) => n + 1)
    if (!result.ok) {
      setError(result.message)
      return
    }
    toast.success("Logo removed")
    await router.invalidate()
  }

  const idleLabel = logoUrl === null ? "Upload logo" : "Replace logo"
  const uploadLabel = pending === "upload" ? "Uploading…" : idleLabel

  return (
    <SettingsSection
      title="Logo"
      description="PNG, JPEG or WebP, at most 512 KB. It is shown on the cover of every report."
    >
      <div className="max-w-xl space-y-4">
        <div className="flex min-h-24 items-center justify-center rounded-md border bg-card p-4">
          {logoUrl === null ? (
            <p className="text-sm text-muted-foreground">No logo yet.</p>
          ) : (
            <img src={logoUrl} alt="Your logo" className="max-h-20 max-w-full object-contain" />
          )}
        </div>
        {canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            <Label
              htmlFor="branding-logo"
              className={cn(
                "inline-flex h-8 cursor-pointer items-center rounded-md border px-3 text-sm font-medium hover:bg-accent has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
                pending !== null && "pointer-events-none opacity-50",
              )}
            >
              {uploadLabel}
              <input
                ref={uploadField}
                id="branding-logo"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={pending !== null}
                onChange={upload}
                className="sr-only"
              />
            </Label>
            {logoUrl === null ? null : (
              <Button type="button" variant="outline" disabled={pending !== null} onClick={remove}>
                {pending === "remove" ? "Removing…" : "Remove logo"}
              </Button>
            )}
            <span className="text-xs text-muted-foreground">
              Saved straight away, without Save branding.
            </span>
          </div>
        ) : null}
        {error === null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          A JPEG can carry hidden data such as the place a photo was taken, and Zinko does not strip
          it. Anyone with a live report link can see the logo.
        </p>
      </div>
    </SettingsSection>
  )
}

function BrandingForm({ data, logo }: { data: Branding; logo: ReactNode }) {
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
    <>
      {logo}
      <SettingsSection
        title="Report branding"
        description="Clients see this on the cover and in the footer of every report you share."
      >
        <form onSubmit={save} className="max-w-xl space-y-5">
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
                    disabled={disabled}
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
              Anyone with the link will see this text. Plain text, printed as typed.{" "}
              {footerText.trim().length} of {FOOTER_MAX} characters.
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
                The agency name looks like it contains an email address or phone number. Reports
                print it exactly as typed.
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
          ) : null}
        </form>
      </SettingsSection>
      <SettingsSection
        title="Cover preview"
        description="How the cover of a report will look with the choices above."
      >
        <div className="max-w-xs">
          <CoverPreview
            agencyName={agencyName}
            logoUrl={branding.logoUrl}
            accent={accent}
            footerText={footerText}
            showPoweredBy={showPoweredBy}
          />
        </div>
      </SettingsSection>
    </>
  )
}

function BrandingSettings() {
  const data = Route.useLoaderData()
  const { logoUrl, ...fields } = data.branding
  return (
    <div className="space-y-6">
      {data.canManage ? null : (
        <p className="text-sm text-muted-foreground">
          Only owners and admins can change branding. You can still edit and share reports.
        </p>
      )}
      <BrandingForm
        key={JSON.stringify(fields)}
        data={data}
        logo={<LogoCard logoUrl={logoUrl} canManage={data.canManage} />}
      />
    </div>
  )
}
