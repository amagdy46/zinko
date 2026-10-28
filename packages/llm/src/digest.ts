import type { ConsentState, Vendor } from "@ovriq/zinko-decoders"
import type {
  CaptureRequest,
  CapturedRequest,
  CaptureResult,
  Scenario,
} from "@repo/capture-contract"
import {
  cookieFamily,
  googleConsentFromCcm,
  isCcmRequest,
  type DecodedHit,
  type EvidenceRef,
} from "@repo/rules"
import { isKnownDestination, knownEvent, pushCommand, VENDOR_LABELS } from "./vocab.js"
import { KNOWN_CMPS } from "./known-cmps.js"

export const MAX_CASES = 5
export const MAX_EVIDENCE = 8

export type Timing = "before-choice" | "after-choice" | "no-choice"

/** Whether the owner allows the site-relative paths of the configured pages to leave. */
export interface Policy {
  includePagePaths: boolean
}

export type DigestEvidence =
  | {
      kind: "hit"
      vendor: string
      destination: string
      event: string
      timing: Timing
      adStorage: ConsentState
      analyticsStorage: ConsentState
    }
  | {
      kind: "request"
      category: "consent-ping" | "collection" | "other"
      timing: Timing
      status: number | null
      blocked: boolean
      adStorage: ConsentState | null
      analyticsStorage: ConsentState | null
    }
  | { kind: "cookie"; name: string; snapshot: string }
  | { kind: "push"; command: string }
  | { kind: "document"; redirects: number; sameOrigin: boolean }

export interface DigestCase {
  runs: number
  page: string
  scenario: string
  viewport: string
  journey: boolean
  consent: { outcome: string; cmp: string | null }
  evidence: DigestEvidence[]
  omittedEvidence: number
}

export interface FindingDigest {
  ruleId: string
  rulesVersions: string[]
  area: string
  severity: "critical" | "warning" | "info"
  title: string
  why: string
  fix: string[]
  failingRuns: number
  knownRuns: number
  policyId: "aliases" | "paths"
  cases: DigestCase[]
  omittedCases: number
  omittedRuns: number
}

/** The stored finding, as loaded: static wording copied from the check results. */
export interface DigestFinding {
  ruleId: string
  rulesVersions: readonly string[]
  area: string
  severity: "critical" | "warning" | "info"
  title: string
  why: string
  fix: readonly string[]
  failingRuns: number
  knownRuns: number
}

/** What the digest reads of a hit: never its parameters, IDs or URL. */
export type DigestHit = Pick<
  DecodedHit,
  "requestId" | "batchIndex" | "vendor" | "destinationId" | "event" | "consent" | "startedAt"
>

/** One failing run with its stored capture and decoded hits, and the failing check's evidence. */
export interface DigestRun {
  /** The page in the audit's configured list: its position, the URL as entered, whether it is the start URL. */
  page: { index: number; url: string; start: boolean }
  scenario: Scenario
  viewport: CaptureRequest["viewport"]
  journey: boolean
  capture: CaptureResult
  hits: readonly DigestHit[]
  evidence: readonly EvidenceRef[]
}

const SCENARIO_ORDER: readonly Scenario[] = ["none", "accept", "reject", "gpc"]
const VIEWPORT_ORDER: readonly CaptureRequest["viewport"][] = ["desktop", "mobile"]
const MAX_PATH_LENGTH = 200
const UNRECOGNISED_CMP = "an unrecognised CMP"

/** Code unit order, the same in every runtime (unlike `localeCompare`). */
function byText(a: string, b: string): number {
  return a < b ? -1 : Number(a > b)
}

/** Keys sorted at every level, so equal values serialise to the same text. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).toSorted(([a], [b]) => byText(a, b)))
      : v,
  )
}

export async function evidenceHash(digest: FindingDigest): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalJson(digest)),
  )
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

/** Numbers each distinct raw value per kind in first-seen order; the raw value itself is never kept in the output. */
function aliaser() {
  const numbers = new Map<string, number>()
  const perKind = new Map<string, number>()
  return (kind: string, raw: string): number => {
    const key = `${kind}\u0000${raw}`
    const known = numbers.get(key)
    if (known !== undefined) return known
    const next = (perKind.get(kind) ?? 0) + 1
    perKind.set(kind, next)
    numbers.set(key, next)
    return next
  }
}

/** The path of a URL as it was entered, without origin, query or fragment. */
function enteredPath(url: string): string {
  const path = url
    .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, "")
    .replace(/[?#].*$/s, "")
    .replace(/\p{Cc}+/gu, " ")
  return (path === "" ? "/" : path).slice(0, MAX_PATH_LENGTH)
}

function pageLabel(page: DigestRun["page"], policy: Policy): string {
  if (policy.includePagePaths) return enteredPath(page.url)
  return `Page ${page.index + 1}${page.start ? " (start page)" : ""}`
}

function timingOf(consent: CaptureResult["consent"], startedAt: number): Timing {
  const { outcome, actionAt } = consent
  if ((outcome === "accepted" || outcome === "rejected") && actionAt !== null)
    return startedAt < actionAt ? "before-choice" : "after-choice"
  return "no-choice"
}

function cmpLabel(cmp: string | null): string | null {
  if (cmp === null || cmp === "") return null
  return KNOWN_CMPS.has(cmp) ? cmp : UNRECOGNISED_CMP
}

function sameOrigin(a: string, b: string): boolean {
  return URL.canParse(a) && URL.canParse(b) && new URL(a).origin === new URL(b).origin
}

/** One reference as a safe fact, or `null` when the run does not hold what it points to. */
function evidenceFact(
  ref: EvidenceRef,
  run: DigestRun,
  alias: ReturnType<typeof aliaser>,
): DigestEvidence | null {
  const { capture } = run
  switch (ref.kind) {
    case "hit": {
      const hit = run.hits.find(
        (h) => h.requestId === ref.requestId && h.batchIndex === ref.batchIndex,
      )
      if (hit === undefined) return null
      const vendor = VENDOR_LABELS[hit.vendor]
      return {
        kind: "hit",
        vendor,
        destination: destinationLabel(hit.vendor, hit.destinationId, alias),
        event: eventLabel(hit.vendor, hit.event, alias),
        timing: timingOf(capture.consent, hit.startedAt),
        adStorage: hit.consent.adStorage,
        analyticsStorage: hit.consent.analyticsStorage,
      }
    }
    case "request": {
      const request = capture.requests.find((r) => r.id === ref.requestId)
      if (request === undefined) return null
      const decodedHit = run.hits.find((h) => h.requestId === request.id)
      const consent = isCcmRequest(request)
        ? googleConsentFromCcm(request)
        : (decodedHit?.consent ?? null)
      return {
        kind: "request",
        category: requestCategory(request, decodedHit !== undefined),
        timing: timingOf(capture.consent, request.startedAt),
        status: request.status,
        blocked: request.blocked,
        adStorage: consent?.adStorage ?? null,
        analyticsStorage: consent?.analyticsStorage ?? null,
      }
    }
    case "cookie":
      return {
        kind: "cookie",
        name: cookieFamily(ref.name) ?? `cookie ${alias("cookie", ref.name)}`,
        snapshot: ref.label,
      }
    case "push": {
      const push = capture.dataLayer[ref.seq]
      return push === undefined ? null : { kind: "push", command: pushCommand(push.value) }
    }
    default: {
      const doc = capture.documents.find((d) => d.id === ref.documentId)
      if (doc === undefined) return null
      return {
        kind: "document",
        redirects: doc.redirects.length,
        sameOrigin: sameOrigin(doc.url, run.page.url),
      }
    }
  }
}

function requestCategory(
  request: CapturedRequest,
  decoded: boolean,
): "consent-ping" | "collection" | "other" {
  if (isCcmRequest(request)) return "consent-ping"
  return decoded ? "collection" : "other"
}

function destinationLabel(vendor: Vendor, id: string, alias: ReturnType<typeof aliaser>): string {
  return isKnownDestination(vendor, id)
    ? id
    : `Destination ${alias(`destination:${vendor}`, id)} (${VENDOR_LABELS[vendor]})`
}

function eventLabel(vendor: Vendor, name: string, alias: ReturnType<typeof aliaser>): string {
  return knownEvent(vendor, name) ? name : `custom event ${alias(`event:${vendor}`, name)}`
}

function runOrder(a: DigestRun, b: DigestRun): number {
  return (
    a.page.index - b.page.index ||
    SCENARIO_ORDER.indexOf(a.scenario) - SCENARIO_ORDER.indexOf(b.scenario) ||
    VIEWPORT_ORDER.indexOf(a.viewport) - VIEWPORT_ORDER.indexOf(b.viewport) ||
    Number(a.journey) - Number(b.journey)
  )
}

/**
 * What a model may see of one failing finding. Every site-controlled string is replaced before
 * it gets here: pages by aliases (or their entered paths when the owner opted in), destination IDs
 * and event names by fixed forms or numbered aliases, cookies by family labels, and the check's
 * message is not used at all. Cases that agree on all of those facts are one case; what the caps
 * cut is counted first. This reduces what leaves; it does not guarantee that no personal data is
 * in a path the owner chose to send.
 */
export function buildDigest(
  finding: DigestFinding,
  runs: readonly DigestRun[],
  policy: Policy,
): FindingDigest {
  const alias = aliaser()
  const groups = new Map<string, DigestCase>()
  for (const run of runs.toSorted(runOrder)) {
    const evidence = run.evidence
      .flatMap((ref) => evidenceFact(ref, run, alias) ?? [])
      .toSorted((a, b) => byText(canonicalJson(a), canonicalJson(b)))
    const label = pageLabel(run.page, policy)
    const facts = {
      page: run.journey ? `Journey from ${label}` : label,
      scenario: run.scenario,
      viewport: run.viewport,
      journey: run.journey,
      consent: { outcome: run.capture.consent.outcome, cmp: cmpLabel(run.capture.consent.cmp) },
      evidence,
    }
    const key = canonicalJson(facts)
    const group = groups.get(key)
    if (group !== undefined) group.runs += 1
    else groups.set(key, { runs: 1, ...facts, omittedEvidence: 0 })
  }
  const all = [...groups.values()]
  const shown = all.slice(0, MAX_CASES)
  for (const c of shown) {
    c.omittedEvidence = Math.max(0, c.evidence.length - MAX_EVIDENCE)
    c.evidence = c.evidence.slice(0, MAX_EVIDENCE)
  }
  const omitted = all.slice(MAX_CASES)
  return {
    ruleId: finding.ruleId,
    rulesVersions: finding.rulesVersions.toSorted(byText),
    area: finding.area,
    severity: finding.severity,
    title: finding.title,
    why: finding.why,
    fix: [...finding.fix],
    failingRuns: finding.failingRuns,
    knownRuns: finding.knownRuns,
    policyId: policy.includePagePaths ? "paths" : "aliases",
    cases: shown,
    omittedCases: omitted.length,
    omittedRuns: omitted.reduce((sum, c) => sum + c.runs, 0),
  }
}
