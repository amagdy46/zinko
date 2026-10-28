import { Link } from "@tanstack/react-router"
import { Palette } from "lucide-react"
import { useSyncExternalStore } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

const KEY = "zinko:report-intro-dismissed"
const DISMISS_EVENT = "zinko:report-intro-dismissed"

const subscribe = (onChange: () => void) => {
  window.addEventListener(DISMISS_EVENT, onChange)
  window.addEventListener("storage", onChange)
  return () => {
    window.removeEventListener(DISMISS_EVENT, onChange)
    window.removeEventListener("storage", onChange)
  }
}

const STEPS = [
  "Check what the client will read, and add your own summary and notes.",
  "Share it as a link you can turn off, or save it as a PDF or a CSV register.",
  "Clients see only the report, never your workspace.",
]

/** The first-run help and the nudge to brand the report; both stay out of print. */
export function ReportIntro({
  unbranded,
  canManageBranding,
}: {
  unbranded: boolean
  canManageBranding: boolean
}) {
  const dismissed = useSyncExternalStore(
    subscribe,
    () => localStorage.getItem(KEY) === "1",
    () => true,
  )
  return (
    <div className="space-y-3 print:hidden">
      {dismissed ? null : (
        <section className="space-y-3 rounded-lg border p-4" aria-label="About the report">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-medium">Send this to your client in three steps</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                localStorage.setItem(KEY, "1")
                window.dispatchEvent(new Event(DISMISS_EVENT))
              }}
            >
              Dismiss
            </Button>
          </div>
          <ol className="grid gap-3 text-sm sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step} className="flex gap-2">
                <span className="text-muted-foreground">{i + 1}.</span>
                {step}
              </li>
            ))}
          </ol>
        </section>
      )}
      {unbranded ? (
        <Alert>
          <Palette />
          <AlertTitle>The report has no agency branding yet</AlertTitle>
          <AlertDescription>
            {canManageBranding ? (
              <>
                It prints your organization's name and no logo.{" "}
                <Link
                  to="/app/settings/branding"
                  className="inline-flex h-8 items-center rounded-md underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  Add a logo and agency name
                </Link>
              </>
            ) : (
              "Ask an owner or admin to add the agency's branding."
            )}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
