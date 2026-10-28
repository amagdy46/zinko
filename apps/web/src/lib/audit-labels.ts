import type { Scenario } from "@repo/capture-contract"
import { count } from "@/lib/format"

/** Mean wall time of one run, measured in Task 5 of the M2 plan. */
const SECONDS_PER_RUN = 12.8

export const SCENARIOS: ReadonlyArray<{ value: Scenario; label: string; hint: string }> = [
  { value: "none", label: "No interaction", hint: "Load the page and leave the banner alone" },
  { value: "accept", label: "Accept all", hint: "Click accept on the consent banner" },
  { value: "reject", label: "Reject all", hint: "Click reject on the consent banner" },
  { value: "gpc", label: "Global Privacy Control", hint: "Send the GPC signal" },
]

export const AREAS: Readonly<Record<string, string>> = {
  consent: "Consent",
  clickids: "Click IDs",
  coverage: "Coverage",
  duplicates: "Duplicates",
  dedup: "Dedup",
  hygiene: "Hygiene",
}

export const scenarioLabel = (scenario: string) =>
  SCENARIOS.find((s) => s.value === scenario)?.label ?? scenario

/** A journey run loads its start URL, then one page per step: it takes as long as that many runs. */
export const runBreakdown = ({
  pages,
  scenarios,
  viewports,
  journeySteps,
}: {
  pages: number
  scenarios: number
  viewports: number
  journeySteps: number
}) => {
  const pageRuns = pages * scenarios * viewports
  const journeyRuns = journeySteps > 0 ? scenarios * viewports : 0
  const journeyWork = journeyRuns * (1 + journeySteps)
  const workUnits = pageRuns + journeyWork
  return {
    runs: pageRuns + journeyRuns,
    workUnits,
    duration: estimateDuration(workUnits),
    lines: [
      {
        label: `${count(pages, "page")} × ${count(scenarios, "scenario")} × ${count(viewports, "viewport")}`,
        runs: pageRuns,
        workUnits: pageRuns,
      },
      ...(journeySteps > 0
        ? [
            {
              label: `Journey × ${count(scenarios, "scenario")} × ${count(viewports, "viewport")}`,
              runs: journeyRuns,
              workUnits: journeyWork,
            },
          ]
        : []),
    ],
  }
}

const estimateDuration = (runs: number) => {
  const minutes = Math.ceil((runs * SECONDS_PER_RUN) / 60)
  return minutes <= 1 ? "about 1 minute" : `about ${minutes} minutes`
}

export const pagePath = (pageUrl: string) => {
  const { pathname, search, hash } = new URL(pageUrl)
  return pathname + search + hash
}

const withHost = (url: string) => new URL(url).host + pagePath(url)

/**
 * A readable label for each page URL: the path alone when no other page shares it, the host and
 * path when only the host tells them apart, the whole URL otherwise. The URL stays the identity.
 */
export const pageLabels = (pageUrls: ReadonlyArray<string>) => {
  const urls = [...new Set(pageUrls)]
  const unique = (label: (url: string) => string, url: string) =>
    urls.filter((other) => label(other) === label(url)).length === 1
  return new Map(
    urls.map((url) => {
      if (unique(pagePath, url)) return [url, pagePath(url)]
      return [url, unique(withHost, url) ? withHost(url) : url]
    }),
  )
}

/** The page a run captures; a journey run starts there and walks on through the key pages. */
export const runPage = (run: { pageUrl: string; journey: boolean }) =>
  run.journey ? `Journey from ${pagePath(run.pageUrl)}` : pagePath(run.pageUrl)

const ERROR_TEXT: Record<string, string> = {
  BotBlocked: "Blocked as a bot",
  Timeout: "The page timed out",
  CmpNotFound: "Consent banner not found",
  ConsentNotApplied: "The consent choice was not seen to take effect",
  Navigation: "Left the site",
  JourneyStep: "A journey step failed",
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

export const runDuration = (run: { startedAt: Date | null; finishedAt: Date | null }) =>
  run.startedAt === null || run.finishedAt === null
    ? null
    : run.finishedAt.getTime() - run.startedAt.getTime()

export const runMeaning = (status: string) => {
  switch (status) {
    case "complete":
      return "captured"
    case "running":
      return "running"
    case "partial":
      return "partial"
    case "failed":
      return "failed"
    default:
      return "queued"
  }
}

export const remainingTime = (remainingUnits: number, elapsed: number, totalUnits: number) => {
  if (elapsed > totalUnits * SECONDS_PER_RUN * 1000 || remainingUnits === 0) return null
  const minutes = (remainingUnits * SECONDS_PER_RUN) / 60
  return `${Math.max(1, Math.floor(minutes * 0.75))}–${Math.max(2, Math.ceil(minutes * 1.5))} minutes left`
}

export const BANNER_NOTE = {
  "not-detected":
    "Our scanner did not detect a consent banner on this page, so whether this is a breach depends on whether a banner exists for the visitor (it may not exist, may not be shown from our location, may load too slowly or may be one we cannot operate).",
  unknown:
    "Our scanner could not tell whether this page has a consent banner (the accept and reject runs of this page did not both finish), so whether this is a breach depends on whether a banner exists for the visitor.",
  summary:
    "Our scanner did not detect a consent banner on these pages, or could not tell whether there is one, so whether these are breaches depends on whether a banner exists for the visitor (it may not exist, may not be shown from our location, may load too slowly or may be one we cannot operate).",
} as const
