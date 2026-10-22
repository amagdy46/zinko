#!/usr/bin/env node
import { parseArgs } from "node:util"
import { decode } from "@ovriq/zinko-decoders"
import {
  CaptureRejected,
  CaptureRequest,
  CaptureResult,
  Scenario,
  isSdkFile,
  isVendorHost,
  type JourneyStep,
} from "@repo/capture-contract"
import {
  RULES_VERSION,
  decodeHits,
  evaluateRun,
  type CheckResult,
  type DecodedHit,
} from "@repo/rules"
import { Schema } from "effect"

const USAGE = `zinko — open-source tracking auditor

Usage:
  zinko decode <hit-url> [--body <raw-body>]   Decode a GA4, Meta, Google Ads or TikTok request
  zinko capture <url> [options]                Load a page in the capture engine and list what it sent
  zinko audit <site-url>                       Crawl and audit a site (coming soon)

capture options:
  --scenario <none|accept|reject|gpc|all>      Consent choice to simulate (default: none; all runs the four)
  --mobile                                     Use a 390x844 mobile viewport
  --click <selector>                           Click an element after the page loads (repeatable)
  --goto <url>                                 Navigate to another URL (repeatable)
  --engine <url>                               Capture engine (default: http://localhost:8080)
  --block-vendors                              Answer vendor collection requests locally
  --rules                                      Run the checks on each scenario and list their results
  --json                                       Print JSON instead of tables (with --rules, adds checks)

--click and --goto run in the order given, at most 5 steps in total.
`

const DEFAULT_ENGINE = "http://localhost:8080"
const SCENARIOS: readonly Scenario[] = ["none", "accept", "reject", "gpc"]
const MAX_STEPS = 5
const REQUEST_TIMEOUT_MS = 180_000

const decodeResult = Schema.decodeUnknownSync(CaptureResult)
const decodeRejected = Schema.decodeUnknownSync(CaptureRejected)
const decodeRequest = Schema.decodeUnknownSync(CaptureRequest)
const isScenario = Schema.is(Scenario)

type Result = CaptureResult

interface Undecoded {
  id: string
  documentId: string
  method: string
  url: string
  startedAt: number
}

class CliError extends Error {}
class Unreachable extends CliError {}

const out = (text: string) => process.stdout.write(`${text}\n`)
const fail = (text: string) => process.stderr.write(`${text}\n`)

function decodeAll(result: Result): { hits: DecodedHit[]; undecoded: Undecoded[] } {
  const hits = decodeHits(result)
  const decoded = new Set(hits.map((hit) => hit.requestId))
  const undecoded = result.requests
    .filter(
      (r) =>
        !decoded.has(r.id) &&
        r.method.toUpperCase() !== "OPTIONS" &&
        isVendorHost(r.url) &&
        !isSdkFile(r.url),
    )
    .map((r) => ({
      id: r.id,
      documentId: r.documentId,
      method: r.method,
      url: r.url,
      startedAt: r.startedAt,
    }))
  return { hits, undecoded }
}

async function runScenario(
  engine: string,
  base: Omit<CaptureRequest, "scenario">,
  scenario: Scenario,
): Promise<Result> {
  const body: CaptureRequest = { ...base, scenario }
  let response: Response
  try {
    response = await fetch(new URL("/capture", engine), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (cause) {
    const reason = cause instanceof Error ? (cause.cause ?? cause) : cause
    // Connection errors are an AggregateError (one per address tried) with an empty message.
    const inner = reason instanceof AggregateError ? reason.errors[0] : reason
    const detail = inner instanceof Error ? inner.message : String(inner)
    throw new Unreachable(`Cannot reach the capture engine at ${engine} (${detail}).`)
  }
  const text = await response.text()
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    json = undefined
  }
  if (response.status === 200) {
    try {
      return decodeResult(json)
    } catch (cause) {
      throw new CliError(
        `The engine returned a 200 that does not match CaptureResult: ${cause instanceof Error ? cause.message : String(cause)}`,
      )
    }
  }
  if (response.status === 400) {
    try {
      const rejected = decodeRejected(json)
      throw new CliError(`The engine refused the request (${rejected.error}): ${rejected.message}`)
    } catch (cause) {
      if (cause instanceof CliError) throw cause
      throw new CliError(`The engine answered 400 with an unrecognized body: ${text.slice(0, 200)}`)
    }
  }
  if (response.status === 429) {
    const retry = response.headers.get("retry-after")
    throw new CliError(
      `The engine is busy or rate limiting (429)${retry ? `; retry after ${retry}s` : ""}.`,
    )
  }
  throw new CliError(`The engine answered ${response.status}: ${text.slice(0, 200)}`)
}

const ms = (value: number | null) => (value === null ? "-" : `${Math.round(value)}ms`)

function pathOf(url: string): string {
  if (!URL.canParse(url)) return url
  const u = new URL(url)
  return `${u.pathname}${u.search}`
}

function table(headers: string[], rows: string[][]): string[] {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)))
  const line = (cells: string[]) =>
    cells
      .map((c, i) => c.padEnd(widths[i]!))
      .join("  ")
      .trimEnd()
  return [line(headers), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)]
}

function renderText(
  url: string,
  scenario: Scenario,
  result: Result,
  hits: DecodedHit[],
  undecoded: Undecoded[],
) {
  const { engine, consent } = result
  out(`== ${url}  [${scenario}]`)
  out(
    `engine: ${engine.name} ${engine.version}${engine.fallbackReason ? ` (fallback: ${engine.fallbackReason})` : ""}`,
  )
  out(
    `consent: ${consent.outcome}, cmp ${consent.cmp ?? "none"}, action at ${ms(consent.actionAt)}, completed at ${ms(consent.completedAt)}`,
  )
  out("")

  const docLabel = (id: string) => {
    const index = result.documents.findIndex((d) => d.id === id)
    const doc = result.documents[index]
    return doc ? `#${index} ${pathOf(doc.url)}` : "#?"
  }
  const undecodedNote = undecoded.length
    ? `; ${undecoded.length} vendor request(s) not decoded`
    : ""
  out(`hits (${hits.length}); "after" = sent at or after the consent action${undecodedNote}`)
  if (hits.length === 0) {
    out("  none")
  } else {
    const { actionAt } = consent
    const rows = hits.map((h) => [
      ms(h.startedAt),
      docLabel(h.documentId),
      h.vendor,
      h.destinationId,
      hits.some((o) => o !== h && o.requestId === h.requestId)
        ? `${h.event} [${h.batchIndex}]`
        : h.event,
      `ad:${h.consent.adStorage} an:${h.consent.analyticsStorage}`,
      actionAt !== null && h.startedAt >= actionAt ? "after" : "",
    ])
    const headers = ["time", "document", "vendor", "destination", "event", "consent", "note"]
    for (const l of table(headers, rows)) out(`  ${l}`)
  }
  out("")

  out("cookies")
  if (result.cookies.length === 0) out("  no snapshots")
  for (const snap of result.cookies) {
    const names = snap.cookies.map((c) => c.name).join(", ") || "(none)"
    out(`  ${snap.label} @ ${ms(snap.at)}  ${docLabel(snap.documentId)}: ${names}`)
  }
  out("")

  out(`errors${result.errors.length === 0 ? ": none" : ""}`)
  for (const e of result.errors) out(`  ${e.code} @ ${ms(e.at)}: ${e.message}`)
  out(`complete: ${result.complete}  truncated: ${result.truncated}`)
  out("")
}

function renderChecks(checks: readonly CheckResult[]) {
  out(`checks (rules v${RULES_VERSION})`)
  const rows = checks.map((c) => [c.status, c.ruleId, c.message, `evidence ${c.evidence.length}`])
  for (const l of table(["status", "rule", "message", "evidence"], rows)) out(`  ${l}`)
  out("")
}

function isHttpUrl(value: string): boolean {
  if (!URL.canParse(value)) return false
  const { protocol, hostname } = new URL(value)
  return (protocol === "http:" || protocol === "https:") && hostname !== ""
}

function parseCapture(argv: string[]) {
  const { values, positionals, tokens } = parseArgs({
    args: argv,
    allowPositionals: true,
    tokens: true,
    options: {
      scenario: { type: "string", default: "none" },
      mobile: { type: "boolean", default: false },
      click: { type: "string", multiple: true },
      goto: { type: "string", multiple: true },
      engine: { type: "string", default: DEFAULT_ENGINE },
      "block-vendors": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      rules: { type: "boolean", default: false },
    },
  })
  const [url] = positionals
  if (!url || positionals.length > 1) throw new CliError("capture needs exactly one <url>.")
  const scenario = values.scenario
  if (scenario !== "all" && !isScenario(scenario)) {
    throw new CliError(`Unknown scenario "${scenario}". Use none, accept, reject, gpc or all.`)
  }
  // Tokens keep the order flags were typed in, which parseArgs' grouped values lose.
  const journey: JourneyStep[] = []
  for (const token of tokens) {
    if (token.kind !== "option" || token.value === undefined) continue
    if (token.name === "click") journey.push({ action: "click", selector: token.value })
    if (token.name === "goto") journey.push({ action: "goto", url: token.value })
  }
  if (journey.length > MAX_STEPS) {
    throw new CliError(
      `At most ${MAX_STEPS} --click/--goto steps are allowed; got ${journey.length}.`,
    )
  }
  const badUrl = [
    url,
    ...journey.flatMap((step) => (step.action === "goto" ? [step.url] : [])),
    values.engine,
  ].find((candidate) => !isHttpUrl(candidate))
  if (badUrl !== undefined) {
    throw new CliError(`"${badUrl}" is not a valid http(s) URL (target, --goto and --engine).`)
  }
  const base = {
    url,
    viewport: values.mobile ? ("mobile" as const) : ("desktop" as const),
    journey,
    blockVendorRequests: values["block-vendors"],
  }
  // Everything but the scenario is the same for each run, so a bad URL or step fails once, here.
  try {
    decodeRequest({ ...base, scenario: "none" })
  } catch (cause) {
    throw new CliError(
      `Invalid capture request: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
  return {
    url,
    base,
    scenarios: scenario === "all" ? SCENARIOS : [scenario],
    engine: values.engine,
    json: values.json,
    rules: values.rules,
  }
}

// Scenarios run one after another; each capture owns a browser on the engine.
async function runFrom(
  opts: ReturnType<typeof parseCapture>,
  index: number,
  failed: boolean,
): Promise<boolean> {
  const scenario = opts.scenarios[index]
  if (scenario === undefined) return failed
  let result: Result
  try {
    result = await runScenario(opts.engine, opts.base, scenario)
  } catch (cause) {
    if (!(cause instanceof Error)) throw cause
    fail(`[${scenario}] ${cause.message}`)
    // An unreachable engine fails every scenario the same way.
    return cause instanceof Unreachable ? true : runFrom(opts, index + 1, true)
  }
  const { hits, undecoded } = decodeAll(result)
  const checks = opts.rules
    ? evaluateRun({
        scenario,
        viewport: opts.base.viewport,
        pageUrl: opts.url,
        siteHost: new URL(opts.url).hostname,
        // as in an audit's journey runs, a journey navigates to other pages; clicks alone do not
        journey: opts.base.journey.some((step) => step.action === "goto"),
        capture: result,
        hits,
      })
    : undefined
  if (opts.json) {
    const { engine, documents, consent, cookies, errors, complete, truncated } = result
    out(
      JSON.stringify(
        {
          scenario,
          engine,
          documents,
          consent,
          hits,
          cookies,
          errors,
          complete,
          truncated,
          undecoded,
          ...(checks === undefined ? {} : { rulesVersion: RULES_VERSION, checks }),
        },
        null,
        2,
      ),
    )
  } else {
    renderText(opts.url, scenario, result, hits, undecoded)
    if (checks !== undefined) renderChecks(checks)
  }
  return runFrom(opts, index + 1, failed || !result.complete)
}

async function capture(argv: string[]): Promise<number> {
  return (await runFrom(parseCapture(argv), 0, false)) ? 1 : 0
}

async function main(argv: string[]): Promise<number> {
  const [command, target, ...rest] = argv
  switch (command) {
    case "decode": {
      if (!target) break
      const bodyFlag = rest.indexOf("--body")
      const body = bodyFlag >= 0 ? rest[bodyFlag + 1] : undefined
      const hits = decode({ url: target, method: body === undefined ? "GET" : "POST", body })
      if (hits.length === 0) {
        console.error("No known tracking hit in that request.")
        return 1
      }
      process.stdout.write(`${JSON.stringify(hits, null, 2)}\n`)
      return 0
    }
    case "capture":
      try {
        return await capture(argv.slice(1))
      } catch (cause) {
        if (!(cause instanceof Error)) throw cause
        fail(cause.message)
        return 2
      }
    case "audit":
      console.error(
        "`audit` is not implemented yet. Track progress at https://github.com/ovriq/zinko",
      )
      return 2
  }
  process.stdout.write(USAGE)
  return command && command !== "help" && command !== "--help" ? 1 : 0
}

process.exitCode = await main(process.argv.slice(2))
