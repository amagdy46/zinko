import { Link } from "@tanstack/react-router"
import { Palette } from "lucide-react"
import { useSyncExternalStore } from "react"
import { Button } from "@/components/ui/button"
import { useReportVoice } from "@/lib/use-agency-voice"

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

/** One slim strip above the report: the first-run help and the nudge to brand it; it stays out of print. */
export function ReportIntro({
  unbranded,
  canManageBranding,
  shared,
}: {
  unbranded: boolean
  canManageBranding: boolean
  shared: boolean
}) {
  const dismissed = useSyncExternalStore(
    subscribe,
    () => localStorage.getItem(KEY) === "1",
    () => true,
  )
  const { who } = useReportVoice()
  const showHelp = !dismissed && !shared
  if (!showHelp && !unbranded) return null
  return (
    <section
      aria-label="About the report"
      className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-muted/40 px-4 py-2 text-sm print:hidden"
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        {showHelp ? (
          <p>
            <span className="font-medium">Before you share it:</span> check what readers will see,
            add your own summary and notes, then share a link you can turn off or save a PDF.
            Readers see only the report. In the print dialog, turn off headers and footers so the
            page address is not printed.
          </p>
        ) : null}
        {unbranded ? (
          <p className="flex flex-wrap items-center gap-x-2 text-muted-foreground">
            <Palette aria-hidden="true" className="size-4 shrink-0" />
            {canManageBranding ? (
              <>
                No branding yet: the report prints your organization's name and no logo.
                <Link
                  to="/app/settings/branding"
                  className="inline-flex h-8 items-center rounded-md text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  Add a logo and {who} name
                </Link>
              </>
            ) : (
              "No branding yet. Ask an owner or admin to add it."
            )}
          </p>
        ) : null}
      </div>
      {showHelp ? (
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
      ) : null}
    </section>
  )
}
