import type { Scenario } from "@repo/capture-contract"
import { count, shortDate } from "@/lib/format"

/**
 * Wall time of one page run (a journey run counts as one per page it loads). Audits of the fixture
 * sites measured 6.3 to 6.8 s per unit (24 to 64 units each); real sites are slower than that, so
 * this leans up. A running audit replaces it with its own pace (see `remainingTime`).
 */
const SECONDS_PER_RUN = 7

export const SCENARIOS: ReadonlyArray<{ value: Scenario; label: string; hint: string }> = [
  { value: "none", label: "No interaction", hint: "Load the page and leave the banner alone" },
  { value: "accept", label: "Accept all", hint: "Click accept on the consent banner" },
  { value: "reject", label: "Reject all", hint: "Click reject on the consent banner" },
  {
    value: "gpc",
    label: "Global Privacy Control",
    hint: "Send the browser setting that tells a site not to sell or share the visitor's data",
  },
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
  crossHostRuns = 0,
}: {
  pages: number
  scenarios: number
  viewports: number
  journeySteps: number
  /** Accept runs that follow a link to a declared host: two page loads each. */
  crossHostRuns?: number
}) => {
  const pageRuns = pages * scenarios * viewports
  const journeyRuns = journeySteps > 0 ? scenarios * viewports : 0
  const journeyWork = journeyRuns * (1 + journeySteps)
  const workUnits = pageRuns + journeyWork + crossHostRuns * 2
  return {
    runs: pageRuns + journeyRuns + crossHostRuns,
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
      ...(crossHostRuns > 0
        ? [
            {
              label: `Other hosts × ${count(crossHostRuns, "host")}`,
              runs: crossHostRuns,
              workUnits: crossHostRuns * 2,
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

/** Why tracking requests are answered by Zinko and never reach a vendor; one sentence, used wherever the caveat shows. */
export const LOCAL_ANSWER_SENTENCE =
  "Zinko answers tracking requests itself so your audit never sends test events to real ad accounts."

export const ERROR_TEXT: Record<string, string> = {
  BotBlocked: "Blocked as a bot",
  Timeout: "The page timed out",
  CmpNotFound: "Consent banner not found",
  ConsentNotApplied: "The consent choice was not seen to take effect",
  Navigation: "Page did not load",
  HttpStatus: "Page returned an error",
  JourneyStep: "A journey step failed",
  PolicyDenied: "Page refused",
  InvalidRequest: "Page refused",
  EngineFailure: "The browser engine failed",
}

export const FAILURE_TEXT: Record<string, string> = {
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
  if (first.code === "Navigation") return navigationReason(first.message)
  if (first.code === "HttpStatus") return httpStatusReason(first.message)
  return ERROR_TEXT[first.code] ?? first.message
}

const NETWORK_ERRORS: ReadonlyArray<readonly [RegExp, string]> = [
  [/ERR_CONNECTION_REFUSED/, "connection refused"],
  [/ERR_NAME_NOT_RESOLVED/, "address not found"],
  [/ERR_CONNECTION_RESET|ERR_EMPTY_RESPONSE|ERR_CONNECTION_CLOSED/, "no response from the server"],
  [/ERR_CONNECTION_TIMED_OUT|ERR_TIMED_OUT|Timeout \d+ms exceeded/, "timed out"],
  [/ERR_CERT|ERR_SSL/, "certificate problem"],
]

const HTTP_STATUS_TEXT: Record<string, string> = {
  "400": "Bad Request",
  "401": "Unauthorized",
  "403": "Forbidden",
  "404": "Not Found",
  "410": "Gone",
  "429": "Too Many Requests",
  "500": "Internal Server Error",
  "502": "Bad Gateway",
  "503": "Service Unavailable",
  "504": "Gateway Timeout",
}

/** The engine's `HttpStatus` message is `<url>: HTTP <status>`. */
const httpStatusReason = (message: string) => {
  const status = /HTTP (\d{3})$/.exec(message)?.[1]
  if (status === undefined) return "Page returned an error"
  const text = HTTP_STATUS_TEXT[status]
  return text === undefined ? `Page returned ${status}` : `Page returned ${status} (${text})`
}

/**
 * The engine's `Navigation` message is `<url>: <what happened>`: a refused hop names the host that
 * is not allowed, a failed load carries the browser's `net::ERR_*` code.
 */
const navigationReason = (message: string) => {
  const host = /(\S+) is not one of the allowed hosts/.exec(message)?.[1]
  if (host !== undefined) return `Redirected to another site (${host})`
  if (message.includes("popup blocked")) return "The page opened a pop-up to another site"
  if (message.includes("not an http(s) page") || message.includes("carries credentials"))
    return "Left the site"
  const detail = NETWORK_ERRORS.find(([pattern]) => pattern.test(message))?.[1]
  return detail === undefined ? "Page did not load" : `Page did not load (${detail})`
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

/** How many phantom units at the estimate weigh into the pace, so the first runs do not swing it. */
const PRIOR_UNITS = 3

/**
 * Time left from the audit's own pace: the elapsed time and the estimate's `PRIOR_UNITS` units
 * spread over the units done so far. One figure, never a range.
 */
export const remainingTime = (remainingUnits: number, elapsed: number, totalUnits: number) => {
  if (remainingUnits === 0) return null
  const done = totalUnits - remainingUnits
  // Until a unit finishes the time spent says nothing about the pace (the audit may only have
  // waited for an engine), so the estimate stays at the prior instead of growing with the wait.
  const pace =
    done === 0
      ? SECONDS_PER_RUN
      : (elapsed / 1000 + PRIOR_UNITS * SECONDS_PER_RUN) / (done + PRIOR_UNITS)
  const seconds = remainingUnits * pace
  if (seconds < 90) return `about ${Math.max(10, Math.round(seconds / 10) * 10)} seconds left`
  const minutes = Math.round(seconds / 60)
  return `about ${minutes} ${minutes === 1 ? "minute" : "minutes"} left`
}

export const BANNER_NOTE = {
  "not-detected":
    "Our scanner did not detect a consent banner on this page, so whether this is a breach depends on whether a banner exists for the visitor (it may not exist, may not be shown from our location, may load too slowly or may be one we cannot operate).",
  unknown:
    "Our scanner could not tell whether this page has a consent banner (the accept and reject runs of this page did not both finish), so whether this is a breach depends on whether a banner exists for the visitor.",
  summary:
    "Our scanner did not detect a consent banner on these pages, or could not tell whether there is one, so whether these are breaches depends on whether a banner exists for the visitor (it may not exist, may not be shown from our location, may load too slowly or may be one we cannot operate).",
} as const

/** The path of an audit's start page when it is not the site's home page, so audits of different pages tell apart. */
export function startPathOf(startPage: string | null | undefined): string | null {
  if (startPage === null || startPage === undefined) return null
  const { pathname } = new URL(startPage)
  return pathname === "/" ? null : pathname
}

/**
 * The audit page's heading: just what it is of. The day, size and start page are the meta line
 * under it (`auditFacts`), so the heading does not wrap into a sentence at narrow widths.
 */
export const auditHeading = (audit: {
  kind: string
  siteName: string
  recheckTitle: string | null
}) =>
  audit.kind === "narrow"
    ? `Re-check of ${audit.recheckTitle ?? "one check"}`
    : `Audit of ${audit.siteName}`

/** The facts that tell audits of one site apart, for the line under the heading. */
export function auditFacts(
  audit: { kind: string; createdAt: Date | string; pages: number; startPath: string | null },
  timeZone?: string,
): string {
  const day = shortDate(audit.createdAt, timeZone)
  if (audit.kind === "narrow") return day
  return [day, count(audit.pages, "page"), audit.startPath]
    .filter((part) => part !== null)
    .join(" · ")
}

/** The same without the day, for the browser tab: a time zone is not known while the head renders. */
export const auditTabName = (audit: {
  kind: string
  siteName: string
  pages: number
  recheckTitle: string | null
}): string =>
  audit.kind === "narrow"
    ? `Re-check of ${audit.recheckTitle ?? "one check"}`
    : `Audit of ${audit.siteName} · ${count(audit.pages, "page")}`
