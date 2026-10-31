import { COOKIE_FAMILY_LABELS, ruleById } from "@repo/rules"
import {
  canonicalJson,
  type DigestEvidence,
  isKnownDestination,
  knownEvent,
  VENDOR_LABELS,
} from "@repo/llm"
import { Data, Effect } from "effect"
import { AREAS, ERROR_TEXT, LOCAL_ANSWER_SENTENCE, SCENARIOS } from "./audit-labels"
import { pageIndexOf } from "./page-match"
import { ACCENTS } from "./report-accent"
import { REPORT_MODEL_VERSION } from "./report-model"
import { count as plural } from "./format"
import type { DisclosureLevel, EvidenceRow, ReportModel } from "./report-model"

/*
 * The disclosure projection: the only place that turns stored data into a string a report prints.
 * Report builders, the snapshot writer and the CSV writer call these functions and nothing else
 * that reads a page, a hit or a capture. `assertProjected` then checks the finished model field by
 * field and fails closed: a leaf path with no registered validator is a defect, so a field added
 * later without review cannot reach a client.
 */

const MAX_PATH_LENGTH = 120

const withoutQueryAndFragment = (url: string) => {
  const { pathname } = new URL(url)
  return pathname.slice(0, MAX_PATH_LENGTH)
}

/**
 * The label of a page of the audit. Standard: its position in the audit's configured list
 * ("Page 2", the first is "Page 1 (start page)"; a journey run is "Journey from Page 1"). Detailed:
 * the entered path without query or fragment, capped. `pages` are the configured pages; a page URL
 * is matched exactly, or minus the test click IDs the audit adds to its start URL.
 */
export function pageLabel(
  pages: ReadonlyArray<string>,
  pageUrl: string,
  journey: boolean,
  detail: DisclosureLevel,
): string {
  const index = pageIndexOf(pages, pageUrl)
  const found = pages[index]
  if (found === undefined)
    throw new ProjectionViolation({ path: "pageLabel", rule: "unknown page" })
  const prefix = journey ? "Journey from " : ""
  if (detail === "detailed") return `${prefix}${withoutQueryAndFragment(found)}`
  return `${prefix}Page ${index + 1}${index === 0 && !journey ? " (start page)" : ""}`
}

/** The name of a vendor as the report prints it; anything the decoders do not know is "Other vendor". */
export const vendorLabel = (vendor: string): string =>
  new Map<string, string>(Object.entries(VENDOR_LABELS)).get(vendor) ?? "Other vendor"

const OTHER_COOKIE = "Other cookie"
const CUSTOM_EVENT = "custom event"
const EMPTY_ROW: EvidenceRow = {
  kind: "hit",
  vendor: null,
  event: null,
  destination: null,
  timing: null,
  adStorage: null,
  analyticsStorage: null,
  category: null,
  status: null,
  blocked: null,
  cookie: null,
  command: null,
  redirects: null,
}

/** Only destination IDs with their vendors' own shape pass: Standard keeps the Google ones, Detailed every shaped one. */
const destinationLabel = (id: string, detail: DisclosureLevel): string | null => {
  if (id.startsWith("Destination ")) return null
  if (/^G-[A-Z0-9]{4,12}$/.test(id) || /^AW-\d{6,17}$/.test(id)) return id
  return detail === "detailed" ? id : null
}

/**
 * One piece of evidence as report rows, from a digest's facts (which already replaced every
 * page-controlled string: cookies by family, events and destinations by known forms or numbered
 * aliases). Here the aliases become fixed words, and Meta and TikTok IDs stay out under Standard.
 * Sorted by their canonical JSON so equal evidence prints the same.
 */
export function evidenceRows(
  evidence: ReadonlyArray<DigestEvidence>,
  detail: DisclosureLevel,
): EvidenceRow[] {
  return evidence
    .map((fact): EvidenceRow => {
      switch (fact.kind) {
        case "hit":
          return {
            ...EMPTY_ROW,
            kind: "hit",
            vendor: fact.vendor,
            event: fact.event.startsWith(CUSTOM_EVENT) ? CUSTOM_EVENT : fact.event,
            destination: destinationLabel(fact.destination, detail),
            timing: fact.timing,
            adStorage: fact.adStorage,
            analyticsStorage: fact.analyticsStorage,
          }
        case "request":
          return {
            ...EMPTY_ROW,
            kind: "request",
            category: fact.category,
            timing: fact.timing,
            status: fact.status,
            blocked: fact.blocked,
            adStorage: fact.adStorage,
            analyticsStorage: fact.analyticsStorage,
          }
        case "cookie":
          return {
            ...EMPTY_ROW,
            kind: "cookie",
            cookie: COOKIE_FAMILY_LABELS.includes(fact.name) ? fact.name : OTHER_COOKIE,
          }
        case "push":
          return { ...EMPTY_ROW, kind: "push", command: fact.command }
        default:
          return { ...EMPTY_ROW, kind: "document", redirects: fact.redirects }
      }
    })
    .toSorted((a, b) => {
      const [x, y] = [canonicalJson(a), canonicalJson(b)]
      return x < y ? -1 : Number(x > y)
    })
}

const VENDORS = ["ga4", "google-ads", "meta", "tiktok"] as const

/** A destination of a changed tag: the same shape rules as an evidence row's; null where Standard keeps it out. */
export const tagDestination = (
  vendor: string,
  id: string,
  detail: DisclosureLevel,
): string | null => {
  if (/^G-[A-Z0-9]{4,12}$/.test(id) || /^AW-\d{6,17}$/.test(id)) return id
  const known = VENDORS.find((v) => v === vendor)
  return detail === "detailed" && known !== undefined && isKnownDestination(known, id) ? id : null
}

/** An event name of a changed tag: a known one, else "custom event" (a page controls the rest). */
export const tagEvent = (vendor: string, event: string): string => {
  const known = VENDORS.find((v) => v === vendor)
  return known !== undefined && knownEvent(known, event) ? event : CUSTOM_EVENT
}

const NO_REASON = "The run failed"
const PARTIAL_REASON = "Some data is missing"
const NOT_CAPTURED = "This page could not be captured in this run"

/** Zinko's own failures (a busy or failed browser engine, a save that failed) read the same to a client: not their problem. */
const OWN_FAILURE_TEXT: Record<string, string> = {
  EngineBusy: NOT_CAPTURED,
  EngineFailure: NOT_CAPTURED,
  PersistFailure: NOT_CAPTURED,
}

/**
 * Plain words for why a run did not finish, from the two static maps only. Unlike `runReason` it
 * never falls back to an error message or reads one for the network detail: those are built from
 * the page.
 */
export function runReasonLabel(run: {
  status: string
  failure: string | null
  errors: ReadonlyArray<{ code: string }>
}): string | null {
  if (run.status !== "partial" && run.status !== "failed") return null
  if (run.failure !== null) return OWN_FAILURE_TEXT[run.failure] ?? NO_REASON
  const [first] = run.errors
  if (first === undefined) return run.status === "partial" ? PARTIAL_REASON : NO_REASON
  return OWN_FAILURE_TEXT[first.code] ?? ERROR_TEXT[first.code] ?? NO_REASON
}

const LOCAL_ANSWER_REASON = `${LOCAL_ANSWER_SENTENCE} Whether vendors accepted the requests was therefore not checked.`

/** The one check Zinko skips by design; the report says so once, in "What was not tested". */
export const isLocalAnswerCheck = (checkTitle: string): boolean =>
  checkTitle === ruleById("hygiene.tag-errors")?.checkTitle

/** Why a check was never run, in words a client can read; only the one check Zinko skips by design has a specific reason. */
export const checkGapReason = (checkTitle: string): string | null =>
  isLocalAnswerCheck(checkTitle) ? LOCAL_ANSWER_REASON : null

export const DELIVERY_NOT_CHECKED = `Delivery errors were not checked. ${LOCAL_ANSWER_SENTENCE} Whether vendors accepted the requests is therefore not known.`

/** The first few checks by title, then how many more; the appendix keeps the full list. */
export const namedChecks = (titles: readonly string[], shown = 3): string =>
  titles.length <= shown
    ? titles.join("; ")
    : `${titles.slice(0, shown).join("; ")}; and ${titles.length - shown} more`

export const neverCheckedLine = (checkTitle: string): string =>
  `${checkTitle}: not checked on any run. This report says nothing about it either way.`

const AREA_MEANING: Readonly<Record<string, string>> = {
  consent:
    "Visitors' cookie choices may not be respected, which can put the site at odds with its own consent promises and with privacy rules.",
  clickids:
    "Visits that came from an ad may not be credited to the campaign that paid for them, so ad results look worse than they are and budgets follow the wrong numbers.",
  coverage:
    "Visits, purchases or revenue may be missing or inaccurate in your reports, so the numbers cannot be taken at face value.",
  duplicates: "Some visits or sales may be counted twice, so the numbers look better than reality.",
  dedup:
    "Ad platforms may count the same sale twice, merge different events into one or drop some, which skews ad reports and the bidding that relies on them.",
  hygiene:
    "Tracking may be sending wrong or unwanted data, or failing without anyone noticing, so the numbers are harder to trust.",
}
const GENERIC_MEANING = "The tracking on the site may not behave the way it should."
const FIXED_MEANING =
  "If the fix holds, this no longer applies. A new audit of the site confirms whether it does."
const ACCEPTED_PREFIX = "This was accepted as a known risk and is not on the to-do list."
const ACCEPTED_NOTE = "The risk itself is unchanged:"

/** Every sentence "What it means for you" can be, so the validator accepts these and nothing else. */
const MEANINGS: ReadonlyArray<string> = [
  ...Object.values(AREA_MEANING),
  GENERIC_MEANING,
  FIXED_MEANING,
  ...[...Object.values(AREA_MEANING), GENERIC_MEANING].map(
    (area) => `${ACCEPTED_PREFIX} ${ACCEPTED_NOTE} ${area}`,
  ),
]

/** "on 1 page, in all 3 scenarios": the pages and scenarios where it failed; a journey run counts with its page. */
export function whereOf(
  pages: ReadonlyArray<string>,
  scenarios: ReadonlyArray<string>,
  configuredScenarios: number,
): string {
  const pageCount = new Set(pages.map((page) => page.replace(/^Journey from /, ""))).size
  const where =
    configuredScenarios > 1 && scenarios.length === configuredScenarios
      ? `all ${configuredScenarios} scenarios`
      : scenarios.join(", ")
  return `on ${plural(pageCount, "page")}${where === "" ? "" : `, in ${where}`}`
}

/**
 * A finding in a client's words, from stored fields only: the run counts say what happened (the
 * title already says what), and a fixed vocabulary keyed by the stored area says what it means. A
 * finding the author marked fixed or accepted says so instead of calling for a fix: a mark is the
 * author's word, not a re-check. The rule's `why` is written for the person who fixes it, so it
 * stays under "Technical detail".
 */
export const clientVoiceOf = (
  finding: {
    area: string
    failingRuns: number
    knownRuns: number
    triage: { status: "open" | "accepted_risk" | "fixed" }
  },
  where: string,
) => {
  const seen = `This showed up in ${finding.failingRuns} of the ${plural(finding.knownRuns, "test run")} where it could be checked, ${where}.`
  const area = AREA_MEANING[finding.area] ?? GENERIC_MEANING
  switch (finding.triage.status) {
    case "fixed":
      return {
        happened: `${seen} It has been marked fixed, but no new audit has confirmed that yet.`,
        means: FIXED_MEANING,
      }
    case "accepted_risk":
      return {
        happened: `${seen} The agency has accepted it as a known risk.`,
        means: `${ACCEPTED_PREFIX} ${ACCEPTED_NOTE} ${area}`,
      }
    default:
      return { happened: seen, means: area }
  }
}

export const NOT_LEGAL_ADVICE =
  "This report describes the technical behaviour of the audited pages in the scenarios listed. It is not legal advice and not a statement of legal compliance: ask a qualified adviser what the findings mean under the rules that apply to the business."

const DECODED_VENDORS = Object.values(VENDOR_LABELS).join(", ")

/**
 * What the audit did not look at, from the audit's own configuration and counts. Every line is a
 * fact about this audit; the two static ones name limits of every audit.
 */
export function notTestedOf(facts: {
  scenarios: ReadonlyArray<string>
  viewports: ReadonlyArray<string>
  pages: number
  journey: boolean
  clickIds: boolean
  runs: { complete: number; partial: number; failed: number }
  banner: { notOperated: number; notDetected: number; unknown: number }
  checksNotRun: number
  checksPartlyRun: number
  deliveryNotChecked: boolean
}): string[] {
  const lines: string[] = []
  const missingScenarios = SCENARIOS.filter((s) => !facts.scenarios.includes(s.value)).map(
    (s) => s.label,
  )
  if (missingScenarios.length > 0)
    lines.push(`Consent scenarios not run: ${missingScenarios.join(", ")}.`)
  const missingViewports = VIEWPORT_LABELS.filter((v) => !facts.viewports.includes(v.toLowerCase()))
  if (missingViewports.length > 0)
    lines.push(`Screen sizes not tested: ${missingViewports.join(", ")}.`)
  lines.push(
    `The ${plural(facts.pages, "page")} listed under Pages ${facts.pages === 1 ? "is" : "are"} the entry ${facts.pages === 1 ? "page" : "pages"} of this audit. Other pages of the site were not checked, except any a check reached by following a link from them, such as in a journey or to another host of the site.`,
  )
  if (!facts.journey) lines.push("No journey through the key pages in one browser session was run.")
  if (!facts.clickIds) lines.push("No landing from an ad click was simulated.")
  const unfinished = facts.runs.partial + facts.runs.failed
  if (unfinished > 0)
    lines.push(
      `${unfinished} of ${plural(facts.runs.complete + unfinished, "run")} did not finish, so those pages and scenarios are only partly covered. The appendix lists them.`,
    )
  if (facts.banner.notOperated > 0)
    lines.push(
      `On ${plural(facts.banner.notOperated, "accept or reject run")} the consent choice was not observed (the banner was not found or could not be operated), so what happens after a choice was not tested there.`,
    )
  if (facts.banner.notDetected > 0)
    lines.push(
      `On ${plural(facts.banner.notDetected, "run")} without a choice, no consent banner was detected on that page, so whether the visitor should have been asked is not established.`,
    )
  if (facts.banner.unknown > 0)
    lines.push(
      `On ${plural(facts.banner.unknown, "run")} without a choice, the page's accept and reject runs did not finish, so whether it has a consent banner is not known.`,
    )
  if (facts.deliveryNotChecked) lines.push(DELIVERY_NOT_CHECKED)
  const otherNotRun = facts.checksNotRun - Number(facts.deliveryNotChecked)
  if (otherNotRun > 0)
    lines.push(
      `${plural(otherNotRun, "check")} could not be run on any run${facts.deliveryNotChecked ? " besides that one" : ""}.`,
    )
  if (facts.checksPartlyRun > 0)
    lines.push(`${plural(facts.checksPartlyRun, "check")} could not be run on some runs.`)
  lines.push(
    `Requests are decoded for ${DECODED_VENDORS}. Requests to any other vendor are not examined.`,
    "What vendors do with the data after they receive it is not tested.",
  )
  return lines
}

export class ProjectionViolation extends Data.TaggedError("ProjectionViolation")<{
  readonly path: string
  readonly rule: string
}> {}

type Validator = (value: unknown, detail: DisclosureLevel) => string | null

const count: Validator = (v) =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? null : "count"
const amount: Validator = (v) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? null : "amount"
const signed: Validator = (v) => (typeof v === "number" && Number.isInteger(v) ? null : "signed")
const flag: Validator = (v) => (typeof v === "boolean" ? null : "flag")
/** An object that is absent: its own path is the leaf. */
const absent: Validator = (v) => (v === null ? null : "absent")
const nullable =
  (inner: Validator): Validator =>
  (v, detail) =>
    v === null ? null : inner(v, detail)
const oneOf =
  (name: string, values: Iterable<string>): Validator =>
  (v) => {
    const set = new Set(values)
    return typeof v === "string" && set.has(v) ? null : name
  }
const matching =
  (name: string, pattern: RegExp, max = 400): Validator =>
  (v) =>
    typeof v === "string" && v.length <= max && pattern.test(v) ? null : name
/** Stored rule wording: static text written in the repository, trusted by origin, length-bounded. */
const stored: Validator = (v) =>
  typeof v === "string" && v.length >= 1 && v.length <= 1200 ? null : "stored"
/** A generated sentence over stored titles and counts. */
const generated: Validator = (v) =>
  typeof v === "string" && v.length >= 1 && v.length <= 600 ? null : "generated"
const author =
  (max: number): Validator =>
  (v) =>
    typeof v === "string" && v.length <= max ? null : "author"
const digest = matching("digest", /^[0-9a-f]{64}$/, 64)
const date = matching("date", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/, 40)
const ruleId = matching("ruleId", /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/, 80)
const ruleVersion = matching("ruleVersion", /^\d{1,4}$/, 4)
const host = matching("host", /^[A-Za-z0-9.:[\]-]{1,255}$/, 255)

const SEVERITIES = ["critical", "warning", "info"]
const OWNERS = ["consent-platform", "tag-manager", "developer"]
const CONSENT_STATES = ["granted", "denied", "unknown"]
const SCENARIO_LABELS = SCENARIOS.map((s) => s.label)
const VIEWPORT_LABELS = ["Desktop", "Mobile"]
const CONSENT_OUTCOMES = ["accepted", "rejected", "none", "not-found", "not-applied"]
const REASONS = [
  ...Object.values(ERROR_TEXT),
  ...Object.values(OWN_FAILURE_TEXT),
  NO_REASON,
  PARTIAL_REASON,
]
const PUSH_COMMANDS = ["consent default", "consent update", "config", "event", "push"]

const vendorLabelValidator = oneOf("vendorLabel", [...Object.values(VENDOR_LABELS), "Other vendor"])
const eventName: Validator = (v) => {
  if (v === "custom event") return null
  return typeof v === "string" && VENDORS.some((vendor) => knownEvent(vendor, v)) ? null : "event"
}
const pageLabelValidator: Validator = (v, detail) => {
  if (typeof v !== "string") return "pageLabel"
  if (detail === "standard")
    return /^(Journey from )?Page \d{1,2}( \(start page\))?$/.test(v) ? null : "pageLabel"
  return /^(Journey from )?\/[^?#\s]{0,119}$/.test(v) && !v.includes("://") ? null : "pageLabel"
}
const destination: Validator = (v, detail) => {
  if (typeof v !== "string") return "destination"
  if (/^G-[A-Z0-9]{4,12}$/.test(v) || /^AW-\d{6,17}$/.test(v)) return null
  if (detail === "standard") return "destination"
  return VENDORS.some((vendor) => isKnownDestination(vendor, v)) ? null : "destination"
}

const finding = {
  ruleId: ruleId,
  severity: oneOf("severity", SEVERITIES),
  area: oneOf("area", Object.keys(AREAS)),
  title: stored,
  why: stored,
  clientVoice: absent,
  "clientVoice.happened": generated,
  "clientVoice.means": oneOf("means", MEANINGS),
  "fix[]": stored,
  owner: nullable(oneOf("owner", OWNERS)),
  ownerSource: oneOf("ownerSource", ["rule", "author", "none"]),
  failingRuns: count,
  knownRuns: count,
  "pages[]": pageLabelValidator,
  "scenarios[]": oneOf("scenario", SCENARIO_LABELS),
  bannerUncertainRuns: count,
  "triage.status": oneOf("triage", ["open", "accepted_risk", "fixed"]),
  "triage.reason": nullable(author(1000)),
  note: nullable(author(1000)),
  evidence: absent,
  "evidence.caption": generated,
  "evidence.rows[].kind": oneOf("kind", ["hit", "request", "cookie", "push", "document"]),
  "evidence.rows[].vendor": nullable(vendorLabelValidator),
  "evidence.rows[].event": nullable(eventName),
  "evidence.rows[].destination": nullable(destination),
  "evidence.rows[].timing": nullable(
    oneOf("timing", ["before-choice", "after-choice", "no-choice"]),
  ),
  "evidence.rows[].adStorage": nullable(oneOf("consentState", CONSENT_STATES)),
  "evidence.rows[].analyticsStorage": nullable(oneOf("consentState", CONSENT_STATES)),
  "evidence.rows[].category": nullable(oneOf("category", ["consent-ping", "collection", "other"])),
  "evidence.rows[].status": nullable(count),
  "evidence.rows[].blocked": nullable(flag),
  "evidence.rows[].cookie": nullable(oneOf("cookie", [...COOKIE_FAMILY_LABELS, OTHER_COOKIE])),
  "evidence.rows[].command": nullable(oneOf("command", PUSH_COMMANDS)),
  "evidence.rows[].redirects": nullable(count),
} satisfies Record<string, Validator>

const under = (prefix: string, table: Record<string, Validator>) =>
  Object.entries(table).map(([path, validator]): [string, Validator] => [
    `${prefix}.${path}`,
    validator,
  ])

/**
 * Every leaf path of `ReportModel` and what may stand there. `[]` stands for an array element. A
 * leaf path that is not listed fails `assertProjected`.
 */
const LEAF_VALIDATORS: ReadonlyMap<string, Validator> = new Map<string, Validator>([
  ["modelVersion", (v) => (v === REPORT_MODEL_VERSION ? null : "modelVersion")],
  ["generatedAt", date],
  ["detail", oneOf("detail", ["standard", "detailed"])],
  ["branding.agencyName", author(80)],
  [
    "branding.accent",
    oneOf(
      "accent",
      ACCENTS.map((a) => a.id),
    ),
  ],
  ["branding.footerText", nullable(author(300))],
  ["branding.showPoweredBy", flag],
  ["branding.logoDigest", nullable(digest)],
  ["cover.clientName", nullable(author(200))],
  ["cover.siteName", author(200)],
  ["cover.host", host],
  ["cover.auditedAt", date],
  ["cover.scope.pages[]", pageLabelValidator],
  ["cover.scope.scenarios[]", oneOf("scenario", SCENARIO_LABELS)],
  ["cover.scope.viewports[]", oneOf("viewport", VIEWPORT_LABELS)],
  ["cover.scope.journey", flag],
  ["cover.scope.clickIds[]", pageLabelValidator],
  ["summary.source", oneOf("source", ["generated", "author"])],
  ["summary.text", nullable(author(2000))],
  ["summary.score.evaluated", (v) => (v === true ? null : "evaluated")],
  ["summary.score.version", count],
  ["summary.score.score", count],
  ["summary.score.band", oneOf("band", ["critical", "attention", "minor", "no-failures"])],
  ["summary.score.coverage", oneOf("coverage", ["full", "partial"])],
  ["summary.score.resolution", oneOf("resolution", ["resolved", "unresolved"])],
  ["summary.score.lines[].ruleId", ruleId],
  ["summary.score.lines[].title", stored],
  ["summary.score.lines[].severity", oneOf("severity", SEVERITIES)],
  ["summary.score.lines[].failing", count],
  ["summary.score.lines[].known", count],
  ["summary.score.lines[].points", amount],
  ["summary.score.lines[].bannerUncertain", count],
  ["summary.score.total", amount],
  ["summary.score.capped", flag],
  ["summary.score.uncertainty.checks", count],
  ["summary.score.uncertainty.runs", count],
  ["summary.score.uncertainty.rules", count],
  ["summary.score.uncertainty.ruleTitles[]", stored],
  ["summary.score.uncertainty.bannerUncertainRuns", count],
  ["summary.score.versions[]", ruleVersion],
  ["summary.score.mixedVersions", flag],
  ["summary.withoutAccepted", nullable(count)],
  ["summary.runHealth.startFailed", flag],
  ["summary.runHealth.startPage", nullable(pageLabelValidator)],
  ["summary.runHealth.startReason", nullable(oneOf("reason", REASONS))],
  ["summary.runHealth.brokenPages[].page", pageLabelValidator],
  ["summary.runHealth.brokenPages[].reason", nullable(oneOf("reason", REASONS))],
  ["summary.runHealth.unfinishedRuns", count],
  ["summary.runHealth.incomplete", flag],
  ["summary.counts.critical", count],
  ["summary.counts.warning", count],
  ["summary.counts.info", count],
  ["summary.counts.couldNotCheck", count],
  ["summary.counts.acceptedRisk", count],
  ["summary.counts.fixed", count],
  ["summary.scoreCoverage.checks", count],
  ["summary.scoreCoverage.unresolvedChecks", count],
  ["summary.checkGaps.blockedRules", count],
  ["summary.checkGaps.neverChecked[]", stored],
  ["summary.checkGaps.otherRules", count],
  ["summary.checkGaps.otherChecks", absent],
  ["summary.checkGaps.otherChecks[]", stored],
  ["summary.checkGaps.otherRuns", nullable(count)],
  ["summary.headlines[]", generated],
  ["summary.coverage.evaluatedRuns", count],
  ["summary.coverage.totalRuns", count],
  ["summary.coverage.unresolvedRules", count],
  ["summary.coverage.unresolvedRuns", nullable(count)],
  ["summary.coverage.bannerUncertainRuns", count],
  ["summary.worst", absent],
  ["summary.worst.ruleId", ruleId],
  ["summary.worst.severity", oneOf("severity", SEVERITIES)],
  ["summary.worst.title", stored],
  ["summary.worst.scopeLine", generated],
  ["method.rulesVersions[]", ruleVersion],
  ["method.scoreVersion", count],
  ["method.runs.complete", count],
  ["method.runs.partial", count],
  ["method.runs.failed", count],
  ["method.mixedVersions", flag],
  ["consent.scenarios[]", oneOf("scenario", SCENARIO_LABELS)],
  ["consent.rows[].vendor", vendorLabelValidator],
  ["consent.rows[].cells[].scenario", oneOf("scenario", SCENARIO_LABELS)],
  ["consent.rows[].cells[].runs.total", count],
  ["consent.rows[].cells[].runs.complete", count],
  ["consent.rows[].cells[].runs.partial", count],
  ["consent.rows[].cells[].runs.none", count],
  ["consent.rows[].cells[].outcomes[].outcome", oneOf("outcome", CONSENT_OUTCOMES)],
  ["consent.rows[].cells[].outcomes[].runs", count],
  ["consent.rows[].cells[].runsWithHits", count],
  ["consent.rows[].cells[].hits", count],
  ["consent.rows[].cells[].choice.observed", count],
  ["consent.rows[].cells[].choice.hitsBefore", count],
  ["consent.rows[].cells[].choice.hitsAfter", count],
  ...under("findings[]", finding),
  ["changes", absent],
  ["changes.baselineDate", date],
  ["changes.counts.new", count],
  ["changes.counts.regressed", count],
  ["changes.counts.fixed", count],
  ["changes.counts.unchanged", count],
  ["changes.counts.verdictChanged", count],
  ["changes.counts.notComparable", count],
  ["changes.omitted", count],
  ["changes.score.before", nullable(count)],
  ["changes.score.now", nullable(count)],
  ["changes.score.delta", nullable(signed)],
  ["changes.items[].ruleId", ruleId],
  ["changes.items[].state", oneOf("state", ["new", "regressed", "fixed", "verdict_changed"])],
  ["changes.items[].severity", oneOf("severity", SEVERITIES)],
  ["changes.items[].title", stored],
  ["changes.items[].pages", count],
  ["changes.items[].pagesCompared", count],
  ["changes.items[].pagesOutside", count],
  ["changes.items[].confidence", oneOf("confidence", ["normal", "low"])],
  [
    "changes.items[].confirmation",
    oneOf("confirmation", ["none", "repeated", "not_repeated", "incomplete"]),
  ],
  ["changes.items[].qualifier", nullable(oneOf("qualifier", ["partly_unknown_before"]))],
  [
    "changes.tags[].change",
    oneOf("tagChange", ["disappeared", "new", "destination_changed", "events_changed"]),
  ],
  ["changes.tags[].vendor", vendorLabelValidator],
  ["changes.tags[].destination", nullable(destination)],
  ["changes.tags[].eventsAdded[]", eventName],
  ["changes.tags[].eventsRemoved[]", eventName],
  ["changes.tags[].cellsAffected", count],
  ["changes.tags[].cellsCompared", count],
  [
    "changes.notices[]",
    oneOf("notice", [
      "rules_changed",
      "scope_differs",
      "banner_differs",
      "consent_differs",
      "score_not_comparable",
    ]),
  ],
  ["changes.lines[]", generated],
  ["limits", absent],
  ["limits.disclaimer", oneOf("disclaimer", [NOT_LEGAL_ADVICE])],
  ["limits.notTested[]", generated],
  ["leftOut[].ruleId", ruleId],
  ["leftOut[].title", stored],
  ["actionPlan[].owner", nullable(oneOf("owner", OWNERS))],
  ["actionPlan[].items[].ruleId", ruleId],
  ["actionPlan[].items[].severity", oneOf("severity", SEVERITIES)],
  ["actionPlan[].items[].title", stored],
  ["actionPlan[].items[].firstStep", stored],
  ["appendix.couldNotCheck[].ruleId", ruleId],
  ["appendix.couldNotCheck[].checkTitle", stored],
  ["appendix.couldNotCheck[].runs", count],
  ["appendix.notEvaluated[].page", pageLabelValidator],
  ["appendix.notEvaluated[].scenario", oneOf("scenario", SCENARIO_LABELS)],
  ["appendix.notEvaluated[].viewport", oneOf("viewport", VIEWPORT_LABELS)],
  ["appendix.notEvaluated[].reason", oneOf("reason", REASONS)],
  ["appendix.rules[].ruleId", ruleId],
  ["appendix.rules[].title", stored],
  ["appendix.rules[].area", oneOf("area", Object.keys(AREAS))],
  ["appendix.rules[].severity", oneOf("severity", SEVERITIES)],
  ["appendix.rules[].version", ruleVersion],
  ["appendix.rules[].pass", count],
  ["appendix.rules[].fail", count],
  ["appendix.rules[].couldNotCheck", count],
  ["appendix.rules[].notApplicable", count],
])

/** Every object and array path the model may have: the prefixes of the registered leaf paths. */
const containerPathsOf = (path: string): string[] => {
  const parts = path.split(".")
  return parts.flatMap((part, i) => {
    const prefix = parts.slice(0, i + 1).join(".")
    const isArray = part.endsWith("[]")
    if (i === parts.length - 1) return isArray ? [prefix.slice(0, -2)] : []
    return isArray ? [prefix.slice(0, -2), prefix] : [prefix]
  })
}

const CONTAINER_PATHS: ReadonlySet<string> = new Set(
  [...LEAF_VALIDATORS.keys()].flatMap(containerPathsOf),
)

/** Leaves not under an array that must be present: not under a nullable object like `summary.worst`. */
const REQUIRED_PATHS = [...LEAF_VALIDATORS.keys()].filter((path) => {
  if (path.includes("[]")) return false
  const parts = path.split(".")
  return !parts.slice(0, -1).some((_, i) => LEAF_VALIDATORS.has(parts.slice(0, i + 1).join(".")))
})

const walk = (
  value: unknown,
  path: string,
  leaves: Array<[string, unknown]>,
  containers: string[],
) => {
  if (Array.isArray(value)) {
    containers.push(path)
    for (const item of value) walk(item, `${path}[]`, leaves, containers)
  } else if (value !== null && typeof value === "object") {
    containers.push(path)
    for (const [key, item] of Object.entries(value))
      walk(item, path === "" ? key : `${path}.${key}`, leaves, containers)
  } else leaves.push([path, value])
}

/**
 * Fails (a defect, never a silent drop) when any leaf of the model has no registered validator or
 * fails its own, when an object or array stands where none is registered (an empty one included),
 * or when a required non-array field is missing. The message names the path and the rule, never
 * the value: it may be personal data.
 */
export const assertProjected = (model: ReportModel, detail: DisclosureLevel) =>
  Effect.suspend(() => {
    const leaves: Array<[string, unknown]> = []
    const containers: string[] = []
    walk(model, "", leaves, containers)
    for (const path of containers.slice(1))
      if (!CONTAINER_PATHS.has(path))
        return Effect.die(new ProjectionViolation({ path, rule: "unregistered container" }))
    for (const [path, value] of leaves) {
      const validator = LEAF_VALIDATORS.get(path)
      const failure = validator === undefined ? "unregistered path" : validator(value, detail)
      if (failure !== null) return Effect.die(new ProjectionViolation({ path, rule: failure }))
    }
    const present = new Set([...leaves.map(([path]) => path), ...containers])
    for (const path of REQUIRED_PATHS)
      if (!present.has(path))
        return Effect.die(new ProjectionViolation({ path, rule: "missing field" }))
    return Effect.void
  })
