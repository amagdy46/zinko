/**
 * The plain Playwright capture engine: the fallback for `scrapling/capture.py`, with the same
 * stdin job, the same NDJSON checkpoints and the same page-side files. Keep the two in step.
 */
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { Schema } from "effect"
import {
  type Browser,
  type BrowserContext,
  chromium,
  type Frame,
  type Page,
  type Request,
  type Response,
  type Route,
} from "playwright"
import { chromiumArgs, isSdkFile, isVendorHost } from "../browser-config.ts"
import { type CaptureError, type Checkpoint, type Consent, EngineJob } from "../contract.ts"

type Document = Extract<Checkpoint, { type: "document" }>["document"]
type CapturedRequest = Extract<Checkpoint, { type: "requests" }>["requests"][number]
type DataLayerPush = Extract<Checkpoint, { type: "dataLayer" }>["entries"][number]
type Snapshot = Extract<Checkpoint, { type: "cookies" }>["snapshot"]
type Observation = Consent["observations"][number]
type Message = { readonly type?: unknown; readonly at: number; readonly frame: Frame } & Record<
  string,
  unknown
>

const GPC_SCRIPT =
  "Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { configurable: true, enumerable: true, get: () => true })"
const AUTOCONSENT_CONFIG = {
  enabled: true,
  autoAction: null,
  disabledCmps: [],
  enablePrehide: false,
  detectRetries: 20,
  enableCosmeticRules: true,
  enableHeuristicDetection: false,
}
const VIEWPORTS = {
  mobile: {
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
  desktop: {
    viewport: { width: 1366, height: 768 },
    screen: { width: 1366, height: 768 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
  },
} as const
const QUIET_MS = 3_000
const WINDOW_CAP_MS = 10_000
const FLUSH_IDLE_CAP_MS = 2_000
const CMP_DETECT_MS = 10_000
const CONSENT_STEP_MS = 15_000
const NAVIGATION_TIMEOUT_MS = 30_000
const CLICK_TIMEOUT_MS = 5_000
const MAX_URL = 8_192
const CHALLENGE_TITLES = new Set(["Just a moment...", "Attention Required! | Cloudflare"])

const emit = (checkpoint: Checkpoint) => process.stdout.write(`${JSON.stringify(checkpoint)}\n`)
const CHUNK_BYTES = 1024 * 1024
/** Splits a checkpoint's items so no line comes near Node's per-line limit. */
const chunks = <T>(items: ReadonlyArray<T>): T[][] => {
  const out: T[][] = [[]]
  let size = 0
  for (const item of items) {
    const length = JSON.stringify(item).length
    const current = out.at(-1) ?? []
    if (current.length > 0 && size + length > CHUNK_BYTES) {
      out.push([item])
      size = length
    } else {
      current.push(item)
      size += length
    }
  }
  return out.filter((part) => part.length > 0)
}
const log = (message: string) => process.stderr.write(`${message}\n`)
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const firstLine = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).split("\n")[0] ?? ""
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const fromJson = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, text: string) =>
  Schema.decodeSync(Schema.fromJsonString(schema))(text)

const job = fromJson(EngineJob, readFileSync(0, "utf8").split("\n")[0] ?? "")
const { request: captureRequest, limits } = job
const scenario = captureRequest.scenario
const playwrightVersion = fromJson(
  Schema.Struct({ version: Schema.String }),
  readFileSync(createRequire(import.meta.url).resolve("playwright/package.json"), "utf8"),
).version
const autoconsentScript = readFileSync(job.files.autoconsent, "utf8")
const initReply = `autoconsentReceiveMessage(${JSON.stringify({
  type: "initResp",
  config: AUTOCONSENT_CONFIG,
  rules: fromJson(Schema.Json, readFileSync(job.files.rules, "utf8")),
})})`

const at = () => Math.max(0, Math.round(Date.now() - job.startedAt))
const remainingMs = () => Math.max(0, Math.round(job.finalizeAt - Date.now()))
const error = (code: CaptureError["code"], message: string) => {
  emit({ type: "error", error: { code, message: message.slice(0, 500), at: at() } })
}

let browser: Browser | undefined
let context: BrowserContext | undefined
let page: Page | undefined
const documents = new Map<string, Document>()
const documentOfRequest = new Map<Request, string>()
let currentDocument: string | undefined
let committed = false
const requests = new Map<string, CapturedRequest>()
const requestIds = new Map<Request, string>()
const blocked = new Set<Request>()
const dirty = new Set<string>()
const inflight = new Set<Request>()
let lastActivity = Date.now()
const dataLayer: DataLayerPush[] = []
let dataLayerSent = 0
let googleObserved = 0
const consent: { -readonly [K in keyof Consent]: Consent[K] } & { observations: Observation[] } = {
  cmp: null,
  outcome: "none",
  actionAt: null,
  completedAt: null,
  observations: [],
}
let consentSent = ""
let truncatedSent = false
let admitted = 0
let endTaken = false
let autoconsentActive = scenario === "accept" || scenario === "reject"
let afterConsentTaken = false
const messages: Message[] = []
const listeners = new Set<() => void>()

const markTruncated = () => {
  if (truncatedSent) return
  truncatedSent = true
  emit({ type: "truncated" })
}

// --- network ------------------------------------------------------------------------------------

const onRequest = (req: Request) => {
  lastActivity = Date.now()
  inflight.add(req)
  if (requests.size >= limits.requests) return markTruncated()
  if (page !== undefined && req.isNavigationRequest() && req.frame() === page.mainFrame()) {
    const previous = req.redirectedFrom()
    const existing = previous === null ? undefined : documentOfRequest.get(previous)
    const document = existing === undefined ? undefined : documents.get(existing)
    if (previous !== null && document !== undefined) {
      documents.set(document.id, {
        ...document,
        url: req.url(),
        redirects: [...document.redirects, previous.url()],
      })
      documentOfRequest.set(req, document.id)
    } else {
      const id = `d${documents.size + 1}`
      documents.set(id, { id, url: req.url(), redirects: [], startedAt: at(), title: null })
      currentDocument = id
      documentOfRequest.set(req, id)
    }
  }
  if (currentDocument === undefined) return
  let raw = req.postDataBuffer()
  let bodyTruncated = false
  if (raw !== null && raw.length > limits.bodyBytes) {
    raw = raw.subarray(0, limits.bodyBytes)
    bodyTruncated = true
    markTruncated()
  }
  const id = `r${requests.size + 1}`
  const url = req.url()
  if (url.length > MAX_URL) markTruncated()
  requestIds.set(req, id)
  requests.set(id, {
    id,
    documentId: currentDocument,
    url: url.slice(0, MAX_URL),
    method: req.method(),
    body: raw === null ? null : raw.toString("utf8"),
    bodyTruncated,
    resourceType: req.resourceType(),
    status: null,
    startedAt: at(),
    blocked: blocked.has(req),
  })
  dirty.add(id)
}

const update = (req: Request, change: Partial<CapturedRequest>) => {
  const id = requestIds.get(req)
  const current = id === undefined ? undefined : requests.get(id)
  if (id === undefined || current === undefined) return
  requests.set(id, { ...current, ...change })
  dirty.add(id)
}

const onResponse = (response: Response) => update(response.request(), { status: response.status() })

const onRequestDone = (req: Request) => {
  lastActivity = Date.now()
  inflight.delete(req)
  // The request event arrives a few ms late; the browser's own start time, known once the
  // request is over, orders requests correctly against dataLayer pushes.
  const { startTime } = req.timing()
  if (startTime > 0) update(req, { startedAt: Math.max(0, Math.round(startTime - job.startedAt)) })
}

/** Resolves once no request has been in flight for 500 ms, or after `capMs`. */
const waitIdle = (capMs: number) =>
  new Promise<void>((resolve) => {
    const deadline = Date.now() + capMs
    const timer = setInterval(() => {
      if (Date.now() < deadline && (inflight.size > 0 || Date.now() - lastActivity < 500)) return
      clearInterval(timer)
      resolve()
    }, 100)
  })

/**
 * Waits until 3 s pass with nothing in flight and no request starting or ending, at most 10 s.
 * A request that starts late (a pixel loaded on a timer) restarts the quiet period.
 */
const observeWindow = () =>
  new Promise<void>((resolve) => {
    const start = Date.now()
    const timer = setInterval(() => {
      const quietSince = Math.max(start, lastActivity)
      const quiet = inflight.size === 0 && Date.now() - quietSince >= QUIET_MS
      if (!quiet && Date.now() < start + WINDOW_CAP_MS) return
      clearInterval(timer)
      resolve()
    }, 100)
  })

// --- page state ---------------------------------------------------------------------------------

const addDataLayer = (entries: unknown) => {
  if (!Array.isArray(entries)) return
  for (const entry of entries) {
    if (!isRecord(entry)) continue
    if (entry.truncated === true || dataLayer.length >= limits.dataLayer) {
      markTruncated()
      continue
    }
    if (currentDocument === undefined) continue
    const pushedAt = entry.at
    dataLayer.push({
      at: typeof pushedAt === "number" ? Math.max(0, Math.round(pushedAt - job.startedAt)) : at(),
      documentId: currentDocument,
      value: JSON.parse(JSON.stringify(entry.value ?? null)),
    })
  }
}

const evaluate = (expression: string, frame?: Frame): Promise<unknown> =>
  (frame ?? page?.mainFrame())?.evaluate(expression) ?? Promise.resolve(null)

const drainPage = async () => {
  addDataLayer(
    await evaluate("window.__zinko ? window.__zinko.drain() : []").catch((cause: unknown) => {
      log(`drain: ${firstLine(cause)}`)
      return []
    }),
  )
  const document = currentDocument === undefined ? undefined : documents.get(currentDocument)
  if (document !== undefined && committed && page !== undefined) {
    const title = await page.title().catch(() => null)
    documents.set(document.id, { ...document, title })
  }
}

const observeConsent = async () => {
  for (const entry of dataLayer.slice(googleObserved)) {
    const value = entry.value
    if (Array.isArray(value) && value.length >= 2 && value[0] === "consent")
      consent.observations.push({
        at: entry.at,
        source: "google",
        state: { command: value[1] ?? null, params: value[2] ?? null },
      })
  }
  googleObserved = dataLayer.length
  if (!committed) return
  const tcf = await evaluate("window.__zinko ? window.__zinko.tcf() : null").catch(() => null)
  if (tcf !== null && tcf !== undefined)
    consent.observations.push({ at: at(), source: "tcf", state: JSON.parse(JSON.stringify(tcf)) })
}

const snapshot = async (label: Snapshot["label"]): Promise<Snapshot> => ({
  at: at(),
  documentId: currentDocument ?? "d1",
  label,
  cookies: ((await context?.cookies()) ?? []).map((cookie) => ({
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    // Playwright reports a session cookie as -1
    expires: cookie.expires < 0 ? null : cookie.expires,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
  })),
})

const checkpoint = async () => {
  await drainPage()
  for (const document of documents.values()) emit({ type: "document", document })
  if (dirty.size > 0) {
    const changed = [...dirty].flatMap((id) => requests.get(id) ?? [])
    for (const part of chunks(changed)) emit({ type: "requests", requests: part })
    dirty.clear()
  }
  if (dataLayer.length > dataLayerSent) {
    for (const part of chunks(dataLayer.slice(dataLayerSent)))
      emit({ type: "dataLayer", entries: part })
    dataLayerSent = dataLayer.length
  }
  const serialized = JSON.stringify(consent)
  if (serialized !== consentSent) {
    emit({ type: "consent", consent })
    consentSent = serialized
  }
}

const flushBeacons = async () => {
  await evaluate("window.__zinko && window.__zinko.hide()").catch((cause: unknown) =>
    log(`hide: ${firstLine(cause)}`),
  )
  await sleep(200)
  await waitIdle(FLUSH_IDLE_CAP_MS)
}

const unhide = () =>
  evaluate("window.__zinko && window.__zinko.show()").catch((cause: unknown) =>
    log(`show: ${firstLine(cause)}`),
  )

// --- autoconsent --------------------------------------------------------------------------------

const injectAutoconsent = async (frame: Frame) => {
  if (!autoconsentActive) return
  await frame
    .evaluate(autoconsentScript)
    .catch((cause: unknown) => log(`inject: ${firstLine(cause)}`))
}

const onAutoconsent = async (frame: Frame, message: unknown) => {
  if (!isRecord(message)) return
  if (message.type === "init") {
    await frame.evaluate(initReply)
    return
  }
  if (message.type === "eval") {
    const result = await frame
      .evaluate(typeof message.code === "string" ? message.code : "")
      .catch(() => false)
    const reply = { id: message.id, type: "evalResp", result }
    await frame.evaluate(`autoconsentReceiveMessage(${JSON.stringify(reply)})`)
    return
  }
  if (message.type === "autoconsentDone" && consent.actionAt !== null && !afterConsentTaken) {
    // The after-consent snapshot is taken the moment autoconsent reports completion.
    afterConsentTaken = true
    consent.completedAt = at()
    emit({ type: "cookies", snapshot: await snapshot("after-consent") })
  }
  messages.push({ ...message, at: at(), frame })
  for (const listener of listeners) listener()
}

const waitMessage = (match: (message: Message) => boolean, timeoutMs: number) =>
  new Promise<Message | undefined>((resolve) => {
    const settle = () => {
      clearTimeout(timer)
      listeners.delete(check)
      resolve(messages.find(match))
    }
    const check = () => {
      if (messages.some(match)) settle()
    }
    const timer = setTimeout(settle, timeoutMs)
    listeners.add(check)
    check()
  })

const nothingDetected = (message: Message) =>
  message.type === "report" &&
  message.mainFrame === true &&
  isRecord(message.state) &&
  message.state.lifecycle === "nothingDetected"

const runConsent = async (loadedAt: number) => {
  const action = scenario === "accept" ? "optIn" : "optOut"
  const found = await waitMessage(
    (message) => message.type === "popupFound" || nothingDetected(message),
    Math.max(0, CMP_DETECT_MS - (Date.now() - loadedAt)),
  )
  const detected = messages.find((message) => message.type === "cmpDetected")
  if (found === undefined || found.type !== "popupFound") {
    consent.cmp = typeof detected?.cmp === "string" ? detected.cmp : null
    consent.outcome = "not-found"
    error("CmpNotFound", "autoconsent found no consent banner to act on")
    return
  }
  const cmp = typeof found.cmp === "string" ? found.cmp : null
  consent.cmp = cmp
  consent.observations.push({ at: found.at, source: "cmp", state: { event: "popupFound", cmp } })
  emit({ type: "cookies", snapshot: await snapshot("before-consent") })
  consent.outcome = action === "optIn" ? "accepted" : "rejected"
  consent.actionAt = at()
  await found.frame.evaluate(`autoconsentReceiveMessage({ type: "${action}" })`)
  const result = await waitMessage((message) => message.type === `${action}Result`, CONSENT_STEP_MS)
  const done = await waitMessage((message) => message.type === "autoconsentDone", CONSENT_STEP_MS)
  autoconsentActive = false
  consent.observations.push({
    at: done?.at ?? at(),
    source: "cmp",
    state: {
      event: `${action}Result`,
      cmp,
      result: result === undefined ? null : result.result === true,
      done: done !== undefined,
    },
  })
  if (result?.result !== true || done === undefined)
    error("EngineFailure", `autoconsent ${action} on ${cmp} did not complete`)
}

// --- the capture --------------------------------------------------------------------------------

const navigate = async (url: string, code: "Navigation" | "JourneyStep") => {
  if (page === undefined) return false
  let response: Response | null
  try {
    response = await page.goto(url, {
      waitUntil: "load",
      timeout: Math.min(NAVIGATION_TIMEOUT_MS, remainingMs()),
    })
  } catch (cause) {
    error(code, `${url}: ${firstLine(cause)}`)
    await checkpoint()
    return false
  }
  committed = true
  const title = await page.title().catch(() => "")
  if (
    response !== null &&
    (response.headers()["cf-mitigated"] === "challenge" || CHALLENGE_TITLES.has(title))
  )
    error("BotBlocked", `${url}: the page answered with a bot challenge (${response.status()})`)
  return true
}

const runStep = async (
  index: number,
  step: NonNullable<EngineJob["request"]["journey"]>[number],
) => {
  if (page === undefined) return false
  const before = currentDocument
  await flushBeacons()
  const held = await snapshot("document-end")
  await checkpoint()
  await unhide()
  if (step.action === "goto") {
    emit({ type: "cookies", snapshot: held })
    if (!(await navigate(step.url, "JourneyStep"))) return false
  } else {
    try {
      await page.click(step.selector, { timeout: CLICK_TIMEOUT_MS })
      await page.waitForLoadState("load", {
        timeout: Math.min(NAVIGATION_TIMEOUT_MS, remainingMs()),
      })
    } catch (cause) {
      error("JourneyStep", `step ${index + 1} click ${step.selector}: ${firstLine(cause)}`)
      return false
    }
  }
  await observeWindow()
  if (step.action === "click" && currentDocument !== before)
    emit({ type: "cookies", snapshot: held })
  return true
}

const finish = async () => {
  if (page === undefined) return
  if (committed) {
    try {
      const shot = await page.screenshot({ type: "png", scale: "css", timeout: 5_000 })
      emit({ type: "screenshot", data: shot.toString("base64") })
    } catch (cause) {
      error("EngineFailure", `screenshot: ${firstLine(cause)}`)
    }
    await flushBeacons()
  }
  if (!endTaken && currentDocument !== undefined) {
    endTaken = true
    emit({ type: "cookies", snapshot: await snapshot("end") })
  }
  await observeConsent()
  await checkpoint()
}

const serveSdk = async (route: Route) => {
  // allHeaders() can wait forever on an intercepted request; build the cookie header here.
  const cookies = (await context?.cookies(route.request().url())) ?? []
  const headers: Record<string, string> = {
    ...route.request().headers(),
    cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "),
  }
  const sent: Record<string, string> = {}
  for (const name of ["user-agent", "accept", "accept-language", "referer", "cookie"]) {
    const value = headers[name]
    if (value !== undefined) sent[name] = value
  }
  const sdkUrl = `${job.proxy}/sdk?url=${encodeURIComponent(route.request().url())}`
  const response = await fetch(sdkUrl, { headers: sent }).catch(() => undefined)
  if (response === undefined) return route.abort("failed")
  // Playwright takes repeated headers such as Set-Cookie joined by newlines.
  const received: Record<string, string> = {}
  for (const [name, value] of response.headers)
    if (name !== "set-cookie" && name !== "connection") received[name] = value
  const setCookies = response.headers.getSetCookie()
  if (setCookies.length > 0) received["set-cookie"] = setCookies.join("\n")
  return route.fulfill({
    status: response.status,
    headers: received,
    body: Buffer.from(await response.arrayBuffer()),
  })
}

const run = async () => {
  // The full Chromium build: headless shell lacks the //chrome switches, such as the WebRTC policy.
  browser = await chromium.launch({ channel: "chromium", args: chromiumArgs(job.proxy) })
  context = await browser.newContext({
    ...VIEWPORTS[captureRequest.viewport],
    serviceWorkers: "block",
    ...(scenario === "gpc" ? { extraHTTPHeaders: { "Sec-GPC": "1" } } : {}),
  })
  emit({
    type: "engine",
    name: "playwright",
    version: `${playwrightVersion} (chromium ${browser.version()})`,
  })
  await context.addInitScript({ path: job.files.shim })
  if (scenario === "gpc") await context.addInitScript({ content: GPC_SCRIPT })
  await context.route("**/*", async (route) => {
    const req = route.request()
    const url = req.url()
    if (admitted >= limits.requests) {
      markTruncated()
      return route.abort("blockedbyclient")
    }
    admitted += 1
    const host = URL.canParse(url) ? new URL(url).hostname : ""
    // The egress proxy refuses vendor hosts outright; these answers only keep page requests on
    // the record, and SDK files come through the proxy's /sdk fetch.
    if (captureRequest.blockVendorRequests === true && isVendorHost(host)) {
      if (isSdkFile(url)) return serveSdk(route)
      blocked.add(req)
      update(req, { blocked: true })
      return route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": (await req.headerValue("origin")) ?? "*",
          "access-control-allow-credentials": "true",
          "access-control-allow-headers": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
        },
        body: "",
      })
    }
    return route.fallback()
  })
  context.on("request", onRequest)
  context.on("response", onResponse)
  context.on("requestfinished", onRequestDone)
  context.on("requestfailed", onRequestDone)
  page = await context.newPage()
  page.on("pageerror", (cause) => log(`pageerror: ${firstLine(cause)}`))
  const main = page.mainFrame()
  await page.exposeBinding("__zinkoDataLayer", ({ frame }, entry: unknown) => {
    if (frame === main) addDataLayer([entry])
  })
  if (autoconsentActive) {
    await page.exposeBinding("autoconsentSendMessage", ({ frame }, message: unknown) =>
      onAutoconsent(frame, message),
    )
    page.on("framenavigated", (frame) => {
      injectAutoconsent(frame).catch(() => undefined)
    })
  }

  if (!(await navigate(captureRequest.url, "Navigation"))) return finish()
  const loadedAt = Date.now()
  await injectAutoconsent(main)
  await observeWindow()
  await observeConsent()
  await checkpoint()

  if (scenario === "accept" || scenario === "reject") {
    await runConsent(loadedAt)
    await checkpoint()
    if (consent.completedAt !== null) {
      await observeWindow()
      await observeConsent()
      await checkpoint()
    }
  }

  // Steps run one after another and stop at the first that fails.
  await (captureRequest.journey ?? []).reduce<Promise<boolean>>(
    (previous, step, index) =>
      previous.then(async (ok) => {
        if (!ok || !(await runStep(index, step))) return false
        await checkpoint()
        return true
      }),
    Promise.resolve(true),
  )
  await finish()
}

const settle = async (work: Promise<void>) => {
  const finalize = new Promise<"finalize">((resolve) =>
    process.once("SIGTERM", () => resolve("finalize")),
  )
  const outcome = await Promise.race([work.then(() => "done" as const), finalize]).catch(
    (cause: unknown) => cause,
  )
  if (outcome === "finalize") {
    error("Timeout", "the capture ran past its time limit; this is what was captured until then")
    await Promise.race([finish(), sleep(4_000)]).catch((cause: unknown) =>
      log(`finalize: ${firstLine(cause)}`),
    )
  } else if (outcome !== "done") {
    if (context === undefined) emit({ type: "launch-failed", message: firstLine(outcome) })
    else {
      error("EngineFailure", firstLine(outcome))
      await Promise.race([finish(), sleep(4_000)]).catch((cause: unknown) =>
        log(`finish after failure: ${firstLine(cause)}`),
      )
    }
  }
  emit({ type: "done" })
  // Node kills this process and the browser once it reads `done`.
  setInterval(() => undefined, 60_000)
}

await settle(run())
