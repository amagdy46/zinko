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
import { chromiumArgs, isCollectionRequest, isSdkFile, isVendorHost } from "../browser-config.ts"
import { type CaptureError, type Checkpoint, type Consent, EngineJob } from "../contract.ts"
import { type FetchReply, guardFrameTargets, type PausedRequest } from "./cdp-frames.ts"

type Document = Extract<Checkpoint, { type: "document" }>["document"]
type CapturedRequest = Extract<Checkpoint, { type: "requests" }>["requests"][number]
type DataLayerPush = Extract<Checkpoint, { type: "dataLayer" }>["entries"][number]
type Snapshot = Extract<Checkpoint, { type: "cookies" }>["snapshot"]
type Observation = Consent["observations"][number]
type ConsentAction = "optIn" | "optOut"
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
// Verifying the consent choice lasts as long as the longest post-action window.
const VERIFY_MS = 10_000
const VERIFY_POLL_MS = 500
const BANNER_CHECK_MS = 2_000
// The banner window of a document loaded after the consent action: polled every 500 ms, each frame
// with its own 1.5 s timeout, until the observation window ends but not before 4 s.
const BANNER_MIN_MS = 4_000
const BANNER_POLL_MS = 500
const BANNER_FRAME_MS = 1_500
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
// autoconsent's Playwright bundle keeps its instance in a local; this names it on `window` so the
// shim's `bannerShown` can re-run the found CMP's popup check after the action. Mirrored in
// capture.py.
const AUTOCONSENT_INSTANCE = "const consent = new AutoConsent("
const AUTOCONSENT_HANDLE = "const consent = window.__zinkoAutoconsent = new AutoConsent("
const autoconsentBundle = readFileSync(job.files.autoconsent, "utf8")
if (!autoconsentBundle.includes(AUTOCONSENT_INSTANCE))
  throw new Error("the autoconsent bundle changed: no instance to name for the banner check")
const autoconsentScript = autoconsentBundle.replace(AUTOCONSENT_INSTANCE, AUTOCONSENT_HANDLE)
const autoconsentRules = fromJson(Schema.Json, readFileSync(job.files.rules, "utf8"))
const initReplyFor = (config: typeof AUTOCONSENT_CONFIG) =>
  `autoconsentReceiveMessage(${JSON.stringify({ type: "initResp", config, rules: autoconsentRules })})`
const initReply = initReplyFor(AUTOCONSENT_CONFIG)
// Watch mode, once the choice is settled: autoconsent only detects, so the banner check works in
// later documents, and it hides nothing. Only `runConsent` ever sends an opt-in or opt-out.
const watchReply = initReplyFor({ ...AUTOCONSENT_CONFIG, enableCosmeticRules: false })

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
// The method of each document's final navigation request: a reload sends it again.
const documentMethod = new Map<string, string>()
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
const autoconsentActive = scenario === "accept" || scenario === "reject"
let afterConsentTaken = false
let watchMode = false
// Node asked this process to wrap up: nothing may wait for a banner window any more.
let finalizing = false
let actionsSent = 0
// How the next top-level document is reached; a navigation no step asked for is a click.
let pendingNavigation: Document["navigation"]
const messages: Message[] = []
const listeners = new Set<() => void>()

const markTruncated = () => {
  if (truncatedSent) return
  truncatedSent = true
  emit({ type: "truncated" })
}

// --- network ------------------------------------------------------------------------------------

// Fetch can answer a redirect before Playwright emits its request event. Keep the attempted
// endpoint and body, then reuse its row if Playwright subsequently reports the same hop.
const blockedRedirects = new Map<string, string[]>()
const observedRedirects = new Map<string, string[]>()
const requestKey = (method: string, url: string) => `${method} ${url}`

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
      documentMethod.set(document.id, req.method())
    } else {
      const id = `d${documents.size + 1}`
      documents.set(id, {
        id,
        url: req.url(),
        redirects: [],
        startedAt: at(),
        title: null,
        navigation: documents.size === 0 ? "start" : (pendingNavigation ?? "click"),
      })
      currentDocument = id
      documentOfRequest.set(req, id)
      documentMethod.set(id, req.method())
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
  const url = req.url()
  const key = requestKey(req.method(), url)
  const intercepted = req.redirectedFrom() === null ? undefined : blockedRedirects.get(key)?.shift()
  const id = intercepted ?? `r${requests.size + 1}`
  if (req.redirectedFrom() !== null && intercepted === undefined) {
    observedRedirects.set(key, [...(observedRedirects.get(key) ?? []), id])
  }
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
    status: intercepted === undefined ? null : 204,
    startedAt: at(),
    blocked: intercepted !== undefined || blocked.has(req),
  })
  dirty.add(id)
}

/** A WebSocket refused before it connected: it has no `Request`, so it is recorded directly. */
const recordBlockedSocket = (url: string) => {
  lastActivity = Date.now()
  if (requests.size >= limits.requests) return markTruncated()
  if (currentDocument === undefined) return
  if (url.length > MAX_URL) markTruncated()
  const id = `r${requests.size + 1}`
  requests.set(id, {
    id,
    documentId: currentDocument,
    url: url.slice(0, MAX_URL),
    method: "GET",
    body: null,
    bodyTruncated: false,
    resourceType: "websocket",
    status: null,
    startedAt: at(),
    blocked: true,
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

// --- site allow-list ----------------------------------------------------------------------------

const allowedHosts = captureRequest.allowedHosts
/** Why the first top-level navigation off the site was refused; the capture stops there. */
let leftSite: string | undefined
let popupRefused = false

/**
 * Why `url` may not be a top-level page under `allowedHosts`: not http(s), credentials, or a host
 * that is neither an allowed host nor a subdomain of one. `undefined` when it may.
 */
const offSite = (url: string): string | undefined => {
  if (allowedHosts === undefined) return undefined
  if (!URL.canParse(url)) return "not a URL"
  const parsed = new URL(url)
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "not an http(s) page"
  if (parsed.username !== "" || parsed.password !== "") return "the URL carries credentials"
  const host = parsed.hostname.replace(/\.$/, "")
  return allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
    ? undefined
    : `${host} is not one of the allowed hosts`
}

const leaveSite = (url: string, reason: string) => {
  if (leftSite !== undefined) return
  leftSite = reason
  error("Navigation", `${url}: ${reason}`)
}

/**
 * Pauses every main-frame document request, redirect hops included (page routes never see those),
 * and fails an off-site one before it is sent. With vendor blocking, pauses all resources to
 * answer collection redirects even inside HTTPS tunnels. A navigation that sends no request (`about:blank`, `blob:`) is caught when it commits.
 */
const guardNavigations = async (target: Page) => {
  if (allowedHosts === undefined && captureRequest.blockVendorRequests !== true) return
  const cdp = await target.context().newCDPSession(target)
  const { frameTree } = await cdp.send("Page.getFrameTree")
  const mainFrameId = frameTree.frame.id
  const seenNetworkRequests = new Set<string>()
  const onPaused = (event: PausedRequest, send: FetchReply) => {
    const { requestId, request } = event
    // Chromium can start a new interception job on a cross-scheme redirect, omitting
    // redirectedRequestId. Its Network request id still identifies the redirect chain.
    const redirect =
      event.redirectedRequestId !== undefined ||
      (event.networkId !== undefined && seenNetworkRequests.has(event.networkId))
    if (event.networkId !== undefined) seenNetworkRequests.add(event.networkId)
    const reason =
      event.resourceType === "Document" && event.frameId === mainFrameId
        ? offSite(request.url)
        : undefined
    if (
      reason === undefined &&
      captureRequest.blockVendorRequests === true &&
      redirect &&
      !isSdkFile(request.url) &&
      isCollectionRequest(request.method, request.url)
    ) {
      if (currentDocument !== undefined && requests.size < limits.requests) {
        const key = requestKey(request.method, request.url)
        const observed = observedRedirects.get(key)?.shift()
        const id = observed ?? `r${requests.size + 1}`
        if (observed === undefined)
          blockedRedirects.set(key, [...(blockedRedirects.get(key) ?? []), id])
        const raw = request.postData === undefined ? null : Buffer.from(request.postData)
        const bodyTruncated = raw !== null && raw.length > limits.bodyBytes
        if (bodyTruncated || request.url.length > MAX_URL) markTruncated()
        requests.set(id, {
          id,
          documentId: currentDocument,
          url: request.url.slice(0, MAX_URL),
          method: request.method,
          body: raw === null ? null : raw.subarray(0, limits.bodyBytes).toString("utf8"),
          bodyTruncated,
          resourceType: event.resourceType.toLowerCase(),
          status: 204,
          startedAt: at(),
          blocked: true,
        })
        dirty.add(id)
      } else if (requests.size >= limits.requests) markTruncated()
      const origin =
        Object.entries(request.headers).find(([key]) => key.toLowerCase() === "origin")?.[1] ?? "*"
      send("Fetch.fulfillRequest", {
        requestId,
        responseCode: 204,
        responseHeaders: Object.entries({
          "access-control-allow-origin": origin,
          "access-control-allow-credentials": "true",
          "access-control-allow-headers": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
        }).map(([name, value]) => ({ name, value })),
        body: "",
      }).catch((cause: unknown) => log(`fetch: ${firstLine(cause)}`))
      return
    }
    const reply =
      reason === undefined
        ? send("Fetch.continueRequest", { requestId })
        : send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" })
    reply.catch((cause: unknown) => log(`fetch: ${firstLine(cause)}`))
    if (reason !== undefined) leaveSite(request.url, reason)
  }
  cdp.on("Fetch.requestPaused", (event) => onPaused(event, cdp.send.bind(cdp)))
  const patterns = [
    {
      urlPattern: "*",
      requestStage: "Request" as const,
      ...(captureRequest.blockVendorRequests === true ? {} : { resourceType: "Document" as const }),
    },
  ]
  await cdp.send("Fetch.enable", { patterns })
  if (captureRequest.blockVendorRequests === true)
    await guardFrameTargets(cdp, patterns, onPaused, (cause) =>
      log(`frame fetch: ${firstLine(cause)}`),
    )
  target.on("framenavigated", (frame) => {
    const url = frame.url()
    if (frame !== target.mainFrame() || currentDocument === undefined) return
    // Chromium's error page follows a failed navigation, which reports its own error.
    if (url.startsWith("chrome-error:")) return
    const reason = offSite(url)
    if (reason !== undefined) leaveSite(url, reason)
  })
}

/**
 * Popups get no navigation guard, so with `allowedHosts` every request a popup makes is refused
 * in the context route (which sees a popup's first request) and the popup is closed.
 */
const isPopupRequest = (req: Request) =>
  allowedHosts !== undefined && page !== undefined && req.frame().page() !== page

const refusePopup = (popup: Page) => {
  if (allowedHosts === undefined) return
  if (!popupRefused) {
    popupRefused = true
    error("Navigation", `popup blocked: the page opened ${popup.url()}`)
  }
  popup.close().catch((cause: unknown) => log(`popup: ${firstLine(cause)}`))
}

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
  if (document !== undefined && committed && leftSite === undefined && page !== undefined) {
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
        documentId: entry.documentId,
      })
  }
  googleObserved = dataLayer.length
  if (!committed) return
  const tcf = await evaluate("window.__zinko ? window.__zinko.tcf() : null").catch(() => null)
  if (tcf !== null && tcf !== undefined)
    consent.observations.push({
      at: at(),
      source: "tcf",
      state: JSON.parse(JSON.stringify(tcf)),
      ...(currentDocument === undefined ? {} : { documentId: currentDocument }),
    })
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
  for (const document of documents.values())
    emit({ type: "document", document: withBanner(document) })
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
    await frame.evaluate(watchMode ? watchReply : initReply)
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

/**
 * A Google consent update that says the choice was made: accept grants ad or analytics storage;
 * reject grants nothing and denies storage.
 */
const choiceMatches = (action: ConsentAction, params: unknown) => {
  if (!isRecord(params)) return false
  const { ad_storage: ad, analytics_storage: analytics } = params
  if (action === "optIn") return ad === "granted" || analytics === "granted"
  return !Object.values(params).includes("granted") && (ad === "denied" || analytics === "denied")
}

/**
 * `matching` when a Google consent update pushed at or after `since` says what the choice means,
 * `contradicting` when updates came but none says so, null when none came.
 */
const consentUpdate = (action: ConsentAction, since: number) => {
  const updates = dataLayer.flatMap(({ at: pushedAt, value }) =>
    Array.isArray(value) && value[0] === "consent" && value[1] === "update" && pushedAt >= since
      ? [value[2]]
      : [],
  )
  if (updates.length === 0) return null
  return updates.some((params) => choiceMatches(action, params)) ? "matching" : "contradicting"
}

const bannerShown = async (
  frame: Frame,
  cmp: string,
  check: "bannerShown" | "bannerWatch" = "bannerShown",
  timeoutMs = BANNER_CHECK_MS,
): Promise<boolean | null> => {
  // A CMP in an iframe can remove its frame along with the banner.
  if (frame.isDetached()) return false
  const shown = await Promise.race([
    frame.evaluate(`window.__zinko ? window.__zinko.${check}(${JSON.stringify(cmp)}) : null`),
    sleep(timeoutMs),
  ]).catch((cause: unknown) => log(`banner check: ${firstLine(cause)}`))
  return typeof shown === "boolean" ? shown : null
}

/**
 * The banner in the frame the action ran in or, once the page has loaded a new document (a CMP
 * that saves the choice and reloads), in any frame of the new one: shown anywhere is shown.
 */
const bannerNow = async (frame: Frame, cmp: string, newDocument: boolean) => {
  if (!newDocument || page === undefined) return bannerShown(frame, cmp)
  const states = await Promise.all(
    page
      .frames()
      .filter((each) => !each.isDetached())
      .map((each) => bannerShown(each, cmp)),
  )
  if (states.includes(true)) return true
  return states.includes(false) ? false : null
}

/** One poll of every live frame in parallel: shown anywhere is shown, else hidden on a definite no. */
const probeBanner = async (cmp: string): Promise<boolean | null> => {
  if (page === undefined) return null
  const states = await Promise.allSettled(
    page
      .frames()
      .filter((each) => !each.isDetached())
      .map((each) => bannerShown(each, cmp, "bannerWatch", BANNER_FRAME_MS)),
  )
  const values = states.map((state) => (state.status === "fulfilled" ? state.value : null))
  if (values.some((value) => value === true)) return true
  return values.some((value) => value === false) ? false : null
}

const isVendorUrl = (url: string) => URL.canParse(url) && isVendorHost(new URL(url).hostname)

/** A script request of the document that was refused, failed or got an error status. */
const failedScript = (documentId: string) =>
  [...requests.values()].some(
    (request) =>
      request.documentId === documentId &&
      request.resourceType === "script" &&
      !request.blocked &&
      // vendor hosts are refused or answered locally by blockVendorRequests, not by the page
      !(captureRequest.blockVendorRequests === true && isVendorUrl(request.url)) &&
      (request.status === null || request.status >= 400),
  )

type BannerState = NonNullable<Document["banner"]>
// One window per main document, started when it commits and bound to its id.
const bannerResults = new Map<string, BannerState>()
const bannerWindows = new Map<string, Promise<void>>()

/** Only a verified accept or reject gives a document a banner state. */
const withBanner = (document: Document): Document => {
  const result = bannerResults.get(document.id)
  const verified = consent.outcome === "accepted" || consent.outcome === "rejected"
  return result !== undefined && verified ? { ...document, banner: result } : document
}

const quietNow = () => inflight.size === 0 && Date.now() - lastActivity >= QUIET_MS

/**
 * Whether the banner of the detected CMP is shown in one document loaded after the consent action.
 * Polls from the document's commit, at least `BANNER_MIN_MS` and until the network has been quiet
 * (at most `WINDOW_CAP_MS`). `shown` is sticky (the first poll that sees it wins), `hidden` needs a
 * definite no with the CMP shown to be there and no yes, anything else is `unknown`; so is a window
 * a navigation interrupts, since what a poll then reads may belong to the next document.
 */
const observeBanner = async (documentId: string, cmp: string) => {
  const start = Date.now()
  const poll = async (seenHidden: boolean): Promise<BannerState> => {
    const state = await probeBanner(cmp)
    if (currentDocument !== documentId) return "unknown"
    if (state === true) return "shown"
    const hidden = seenHidden || state === false
    const elapsed = Date.now() - start
    if (elapsed >= WINDOW_CAP_MS || (elapsed >= BANNER_MIN_MS && quietNow()))
      return hidden ? "hidden" : "unknown"
    await sleep(BANNER_POLL_MS)
    return poll(hidden)
  }
  const polled = await poll(false)
  // A script of the page that failed may be the consent platform: an absent banner proves nothing.
  const result = polled === "hidden" && failedScript(documentId) ? "unknown" : polled
  bannerResults.set(documentId, result)
  log(`banner window ${documentId}: ${result} after ${Date.now() - start} ms`)
}

/** Waits for the windows still open, or at the deadline gives up on them: an unfinished one is `unknown`. */
const closeBannerWindows = async () => {
  const open = [...bannerWindows].filter(([documentId]) => !bannerResults.has(documentId))
  if (!finalizing) await Promise.all(open.map(([, window]) => window))
  for (const [documentId] of open)
    if (!bannerResults.has(documentId)) bannerResults.set(documentId, "unknown")
}

/** At a main document's commit: watch its banner, if it loaded after the consent action. */
const watchBanner = (documentId: string) => {
  const document = documents.get(documentId)
  if (
    consent.cmp === null ||
    consent.actionAt === null ||
    document === undefined ||
    document.startedAt <= consent.actionAt ||
    bannerWindows.has(documentId)
  )
    return
  bannerWindows.set(
    documentId,
    observeBanner(documentId, consent.cmp).catch((cause: unknown) => {
      log(`banner window: ${firstLine(cause)}`)
    }),
  )
}

type Verification = {
  action: ConsentAction
  cmp: string | null
  actionAt: number
  at: number
  reported: boolean | null
  done: boolean
  bannerShown: boolean | null
  consentUpdate: "matching" | "contradicting" | null
  newDocument: boolean
  checkedAt: number
}
// What verification of the consent action has seen, until `settleConsent` turns it into the outcome.
let verification: Verification | undefined
let verifying: Promise<void> | undefined

/**
 * Watches for evidence that the choice took effect, the banner gone or a matching consent update,
 * until one appears or `deadline` passes; it runs alongside the post-action window. autoconsent's
 * result only says its steps ran: its Cookiebot opt-in reports success whether or not it found a
 * button to click.
 */
const verifyChoice = async (
  state: Verification,
  frame: Frame,
  document: string | undefined,
  deadline: number,
): Promise<void> => {
  if (state !== verification) return
  await drainPage()
  state.newDocument = currentDocument !== document
  state.bannerShown = await bannerNow(frame, state.cmp ?? "", state.newDocument)
  state.consentUpdate = consentUpdate(state.action, state.actionAt)
  state.checkedAt = at()
  if (state.bannerShown === false || state.consentUpdate === "matching" || Date.now() >= deadline)
    return
  await sleep(VERIFY_POLL_MS)
  return verifyChoice(state, frame, document, deadline)
}

const SAID = { true: "reported success", false: "reported failure", null: "did not answer" }

/**
 * Turns what verification saw into the outcome, also when Node asks to finalize before it ended.
 * Without evidence the outcome is `not-applied`, whether the banner was seen to stay or could not
 * be checked: consent rules judged on a choice nobody saw take effect are the bug this fixes.
 */
const settleConsent = () => {
  const state = verification
  if (state === undefined) return
  verification = undefined
  const { action, cmp, bannerShown: shown, consentUpdate: seenUpdate } = state
  const evidence = [
    ...(shown === false ? ["banner-closed"] : []),
    ...(seenUpdate === "matching" ? ["consent-update"] : []),
  ]
  let verdict = "unverified"
  if (evidence.length > 0) verdict = "applied"
  else if (shown === true) verdict = "not-applied"
  consent.observations.push({
    at: state.at,
    source: "cmp",
    state: {
      event: `${action}Result`,
      cmp,
      result: state.reported,
      done: state.done,
      bannerShown: shown,
      consentUpdate: seenUpdate,
      newDocument: state.newDocument,
      evidence,
      verdict,
    },
  })
  if (evidence.length > 0) {
    consent.outcome = action === "optIn" ? "accepted" : "rejected"
    if (state.reported !== true || !state.done)
      error("EngineFailure", `autoconsent ${action} on ${cmp} did not complete`)
    return
  }
  consent.outcome = "not-applied"
  const followed =
    seenUpdate === null
      ? "no consent update followed"
      : "the consent update that followed did not match the choice"
  const seconds = Math.max(0, Math.round((state.checkedAt - state.actionAt) / 1000))
  const why =
    verdict === "not-applied"
      ? `the banner was still shown ${seconds} s later and ${followed}`
      : `it could not be checked: the banner check gave no answer for ${seconds} s and ${followed}`
  error(
    "ConsentNotApplied",
    `autoconsent ${action} on ${cmp} ${SAID[`${state.reported}`]}, but ${why}`,
  )
}

const runConsent = async (loadedAt: number) => {
  const action: ConsentAction = scenario === "accept" ? "optIn" : "optOut"
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
  const actionAt = at()
  const document = currentDocument
  consent.actionAt = actionAt
  actionsSent += 1
  // Documents loaded from here on (a CMP that reloads the page) get a watching autoconsent.
  watchMode = true
  await found.frame.evaluate(`autoconsentReceiveMessage({ type: "${action}" })`)
  const result = await waitMessage((message) => message.type === `${action}Result`, CONSENT_STEP_MS)
  const done = await waitMessage((message) => message.type === "autoconsentDone", CONSENT_STEP_MS)
  // autoconsent stays injected until the outcome is settled, so a reloaded page gets an instance
  // that can look for the banner again.
  const state: Verification = {
    action,
    cmp,
    actionAt,
    at: done?.at ?? at(),
    reported: result === undefined ? null : result.result === true,
    done: done !== undefined,
    bannerShown: null,
    consentUpdate: null,
    newDocument: false,
    checkedAt: actionAt,
  }
  verification = state
  verifying = verifyChoice(state, found.frame, document, Date.now() + VERIFY_MS)
}

// --- the capture --------------------------------------------------------------------------------

const navigate = async (
  label: string,
  code: "Navigation" | "JourneyStep",
  go: (timeout: number) => Promise<Response | null>,
) => {
  if (page === undefined) return false
  let response: Response | null
  try {
    response = await go(Math.min(NAVIGATION_TIMEOUT_MS, remainingMs()))
  } catch (cause) {
    // A refused off-site hop has its own `Navigation` error.
    if (leftSite === undefined) error(code, `${label}: ${firstLine(cause)}`)
    await checkpoint()
    return false
  }
  committed = true
  const title = await page.title().catch(() => "")
  if (response === null) return true
  const document = currentDocument === undefined ? undefined : documents.get(currentDocument)
  if (document !== undefined) documents.set(document.id, { ...document, status: response.status() })
  if (response.headers()["cf-mitigated"] === "challenge" || CHALLENGE_TITLES.has(title))
    error("BotBlocked", `${label}: the page answered with a bot challenge (${response.status()})`)
  else if (response.status() >= 400) error("HttpStatus", `${label}: HTTP ${response.status()}`)
  return true
}

const reloadRefusal = (
  before: string | undefined,
  method: string | undefined,
  navigating: boolean,
): string | undefined => {
  if (currentDocument !== before) return "the page navigated by itself"
  if (navigating) return "the page is navigating"
  if (method === "GET") return undefined
  return `the page was loaded with ${method ?? "an unknown method"}, and a reload would send it again`
}

const runStep = async (
  index: number,
  step: NonNullable<EngineJob["request"]["journey"]>[number],
) => {
  const current = page
  if (current === undefined || leftSite !== undefined) return false
  const before = currentDocument
  // Leaving a page ends its banner window, so let it finish first.
  await (before === undefined ? undefined : bannerWindows.get(before))
  await flushBeacons()
  const held = await snapshot("document-end")
  await observeConsent()
  await checkpoint()
  await unhide()
  // Checked last, right before the reload: a form the page submits by itself (on a timer, or on the
  // pagehide the flush above causes) can swap the document while this step waited.
  if (step.action === "reload") {
    const method = currentDocument === undefined ? undefined : documentMethod.get(currentDocument)
    const navigating = [...inflight].some(
      (request) => request.isNavigationRequest() && request.frame() === current.mainFrame(),
    )
    const refusal = reloadRefusal(before, method, navigating)
    if (refusal !== undefined) {
      error("JourneyStep", `step ${index + 1} reload of ${current.url()}: ${refusal}`)
      return false
    }
  }
  if (step.action === "goto" || step.action === "reload") {
    emit({ type: "cookies", snapshot: held })
    pendingNavigation = step.action
    const opened =
      step.action === "goto"
        ? await navigate(step.url, "JourneyStep", (timeout) =>
            current.goto(step.url, { waitUntil: "load", timeout }),
          )
        : await navigate(`step ${index + 1} reload of ${current.url()}`, "JourneyStep", (timeout) =>
            current.reload({ waitUntil: "load", timeout }),
          )
    if (!opened) {
      pendingNavigation = undefined
      return false
    }
  } else {
    pendingNavigation = "click"
    try {
      await current.click(step.selector, { timeout: CLICK_TIMEOUT_MS })
      await current.waitForLoadState("load", {
        timeout: Math.min(NAVIGATION_TIMEOUT_MS, remainingMs()),
      })
    } catch (cause) {
      pendingNavigation = undefined
      error("JourneyStep", `step ${index + 1} click ${step.selector}: ${firstLine(cause)}`)
      return false
    }
  }
  pendingNavigation = undefined
  const banner =
    currentDocument !== undefined && currentDocument !== before
      ? bannerWindows.get(currentDocument)
      : undefined
  await Promise.all([observeWindow(), banner])
  if (step.action === "click" && currentDocument !== before)
    emit({ type: "cookies", snapshot: held })
  // A click can start an off-site navigation after `load` has already resolved.
  return leftSite === undefined
}

const finish = async () => {
  if (page === undefined) return
  settleConsent()
  await closeBannerWindows()
  // After a refused navigation the page shows Chromium's error page: nothing to photograph.
  if (committed && leftSite === undefined) {
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
    if (isPopupRequest(req)) {
      log(`popup request refused: ${url}`)
      blocked.add(req)
      update(req, { blocked: true })
      return route.abort("blockedbyclient")
    }
    const host = URL.canParse(url) ? new URL(url).hostname : ""
    // The egress proxy refuses vendor hosts outright; these answers only keep page requests on
    // the record, and SDK files come through the proxy's /sdk fetch.
    if (
      captureRequest.blockVendorRequests === true &&
      (isVendorHost(host) || isCollectionRequest(req.method(), url))
    ) {
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
  // Page routes never see WebSockets and the proxy only sees a CONNECT, so a socket to a collector
  // is refused here, before it connects. Other sockets are not routed and keep the proxy path.
  if (captureRequest.blockVendorRequests === true)
    await context.routeWebSocket(
      (socket) => isVendorHost(socket.hostname) || isCollectionRequest("GET", socket.href),
      (socket) => {
        recordBlockedSocket(socket.url())
        return socket.close({ code: 1008, reason: "blocked by blockVendorRequests" })
      },
    )
  context.on("request", onRequest)
  context.on("response", onResponse)
  context.on("requestfinished", onRequestDone)
  context.on("requestfailed", onRequestDone)
  page = await context.newPage()
  await guardNavigations(page)
  context.on("page", refusePopup)
  page.on("pageerror", (cause) => log(`pageerror: ${firstLine(cause)}`))
  page.on("framenavigated", (frame) => {
    if (frame !== page?.mainFrame() || currentDocument === undefined) return
    if (!frame.url().startsWith("chrome-error:")) watchBanner(currentDocument)
  })
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

  if (
    !(await navigate(captureRequest.url, "Navigation", (timeout) =>
      main.goto(captureRequest.url, { waitUntil: "load", timeout }),
    ))
  )
    return finish()
  const loadedAt = Date.now()
  await injectAutoconsent(main)
  await observeWindow()
  await observeConsent()
  await checkpoint()
  // The page sent itself off the site (a script redirect) while it was being observed.
  if (leftSite !== undefined) return finish()

  if (scenario === "accept" || scenario === "reject") {
    await runConsent(loadedAt)
    await checkpoint()
    if (consent.completedAt !== null) await observeWindow()
    if (verifying !== undefined) {
      await verifying
      settleConsent()
    }
    if (consent.completedAt !== null) await observeConsent()
    await checkpoint()
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
    process.once("SIGTERM", () => {
      finalizing = true
      resolve("finalize")
    }),
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
  log(`actionsSent=${actionsSent}`)
  emit({ type: "done" })
  // Node kills this process and the browser once it reads `done`.
  setInterval(() => undefined, 60_000)
}

await settle(run())
