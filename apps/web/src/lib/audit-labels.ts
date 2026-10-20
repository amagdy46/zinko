import type { Scenario } from "@repo/capture-contract"

/** Mean wall time of one run, measured in Task 5 of the M2 plan. */
const SECONDS_PER_RUN = 12.8

export const SCENARIOS: ReadonlyArray<{ value: Scenario; label: string; hint: string }> = [
  { value: "none", label: "No interaction", hint: "Load the page and leave the banner alone" },
  { value: "accept", label: "Accept all", hint: "Click accept on the consent banner" },
  { value: "reject", label: "Reject all", hint: "Click reject on the consent banner" },
  { value: "gpc", label: "Global Privacy Control", hint: "Send the GPC signal" },
]

export const scenarioLabel = (scenario: string) =>
  SCENARIOS.find((s) => s.value === scenario)?.label ?? scenario

export const estimateDuration = (runs: number) => {
  const minutes = Math.ceil((runs * SECONDS_PER_RUN) / 60)
  return minutes <= 1 ? "about 1 minute" : `about ${minutes} minutes`
}

export const pagePath = (pageUrl: string) => {
  const { pathname, search } = new URL(pageUrl)
  return pathname + search
}

const ERROR_TEXT: Record<string, string> = {
  BotBlocked: "Blocked as a bot",
  Timeout: "The page timed out",
  CmpNotFound: "Consent banner not found",
  Navigation: "Left the site",
  PolicyDenied: "Page refused",
  InvalidRequest: "Page refused",
  EngineFailure: "The browser engine failed",
}

const FAILURE_TEXT: Record<string, string> = {
  EngineBusy: "Zinko was busy, re-run the audit",
  EngineFailure: "The browser engine failed",
  PersistFailure: "Captured, but the results could not be saved",
}

type RunProblem = {
  status: string
  failure: string | null
  errors: ReadonlyArray<{ code: string; message: string }>
}

/** Plain words for why a partial or failed run is not whole; null for any other run. */
export const runReason = (run: RunProblem): string | null => {
  if (run.status !== "partial" && run.status !== "failed") return null
  if (run.failure !== null) return FAILURE_TEXT[run.failure] ?? "The run failed"
  const [first] = run.errors
  if (first === undefined)
    return run.status === "partial" ? "Some data is missing" : "The run failed"
  return ERROR_TEXT[first.code] ?? first.message
}
