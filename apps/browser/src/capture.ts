/**
 * Runs one capture: an engine child process behind the egress proxy, with the time limit, and the
 * `CaptureResult` assembled from the checkpoints the engine wrote. Scrapling is the engine; plain
 * Playwright runs instead when `CAPTURE_ENGINE=playwright`, or when Scrapling fails to launch.
 */
import { spawn } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { Readable } from "node:stream"
import { fileURLToPath } from "node:url"
import { Exit, Schema } from "effect"
import { files, isSdkFile, isVendorHost } from "./browser-config.ts"
import {
  type CaptureError,
  type CaptureRequest,
  type CaptureResult,
  Checkpoint,
  type EngineJob,
  type EngineName,
} from "./contract.ts"
import { startEgressProxy, type Refusal } from "./egress-proxy.ts"
import { watchProcessTree } from "./process-tree.ts"

export const LIMITS = {
  /**
   * Plus `perStepMs` for each journey step: a page costs its windows and gtag's batch delay. An
   * average budget, not a guarantee: the steps run in order, so a deadline cuts the last ones.
   */
  durationMs: 60_000,
  perStepMs: 15_000,
  /** The ceiling whatever the step count; the engine finalizes `finalizeBeforeMs` before it. */
  maxDurationMs: 200_000,
  /** Asks the engine to flush what it has this long before the hard deadline. */
  finalizeBeforeMs: 6_000,
  requests: 2_000,
  bodyBytes: 64 * 1024,
  dataLayer: 1_000,
  /** What the egress proxy relays to the browser, plus `responseBytesPerStep` for each journey step. */
  responseBytes: 10 * 1024 * 1024,
  responseBytesPerStep: 4 * 1024 * 1024,
  /** The whole result, counted over the checkpoints it is built from. */
  resultBytes: 10 * 1024 * 1024,
  /** One checkpoint line; a longer one is dropped unread. */
  lineBytes: 4 * 1024 * 1024,
} as const

/** Below this much time left, a failed Scrapling launch is not retried with Playwright. */
const MIN_FALLBACK_MS = 15_000

const appRoot = fileURLToPath(new URL("..", import.meta.url))

const commands: Record<EngineName, readonly [string, ...string[]]> = {
  scrapling: [
    join(appRoot, "scrapling/.venv/bin/python"),
    "-I",
    join(appRoot, "scrapling/capture.py"),
  ],
  playwright: [
    process.execPath,
    "--experimental-strip-types",
    join(appRoot, "src/engines/playwright.ts"),
  ],
}

const decodeCheckpoint = Schema.decodeUnknownExit(Schema.fromJsonString(Checkpoint))

/** Checkpoints that carry captured data and count against `LIMITS.resultBytes`. */
const dataCheckpoints = new Set([
  "document",
  "requests",
  "dataLayer",
  "cookies",
  "consent",
  "screenshot",
])

/** Splits a stream into lines without ever buffering more than `maxBytes` of one line. */
const readLines = (
  stream: Readable,
  maxBytes: number,
  onLine: (line: string) => void,
  onOversized: () => void,
) => {
  let parts: Buffer[] = []
  let size = 0
  let skipping = false
  stream.on("data", (chunk: Buffer) => {
    let offset = 0
    while (offset < chunk.length) {
      const newline = chunk.indexOf(10, offset)
      const piece = chunk.subarray(offset, newline === -1 ? chunk.length : newline)
      if (!skipping) {
        size += piece.length
        if (size > maxBytes) {
          skipping = true
          parts = []
          onOversized()
        } else parts.push(piece)
      }
      if (newline === -1) return
      if (!skipping) onLine(Buffer.concat(parts).toString("utf8"))
      parts = []
      size = 0
      skipping = false
      offset = newline + 1
    }
  })
}

type EngineRun = {
  readonly checkpoints: ReadonlyArray<Checkpoint>
  /** The engine's `launch-failed` message, or why it never reported a launched browser. */
  readonly launchFailure: string | null
  readonly timedOut: boolean
  readonly crashed: string | null
  /** A checkpoint line or the result as a whole passed its size limit. */
  readonly outputTruncated: boolean
}

const runEngine = (name: EngineName, job: EngineJob, deadline: number): Promise<EngineRun> =>
  new Promise((resolve) => {
    const [command, ...args] = commands[name]
    const checkpoints: Checkpoint[] = []
    let stderrTail = ""
    let launched = false
    let launchFailure: string | null = null
    let sawDone = false
    let timedOut = false
    let settled = false
    let outputBytes = 0
    let outputTruncated = false

    const child = spawn(command, args, {
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, TMPDIR: dirname(job.profileDir) },
    })
    const tree = child.pid === undefined ? undefined : watchProcessTree(child.pid)
    const sampler = setInterval(() => tree?.sample(), 250)

    const settle = (crashed: string | null) => {
      if (settled) return
      settled = true
      clearInterval(sampler)
      clearTimeout(finalizeTimer)
      clearTimeout(killTimer)
      clearTimeout(giveUpTimer)
      tree?.kill()
      resolve({
        checkpoints,
        launchFailure: launched ? null : (launchFailure ?? crashed ?? "the engine never started"),
        timedOut,
        crashed: sawDone ? null : crashed,
        outputTruncated,
      })
    }

    const finalizeTimer = setTimeout(() => {
      if (child.pid !== undefined && child.exitCode === null) process.kill(child.pid, "SIGTERM")
    }, job.finalizeAt - Date.now())
    const killTimer = setTimeout(() => {
      timedOut = !sawDone
      tree?.kill()
    }, deadline - Date.now())
    // The pipes close once every process holding them is gone; never wait past this.
    const giveUpTimer = setTimeout(
      () => settle("the engine did not exit"),
      deadline - Date.now() + 2_000,
    )

    child.on("error", (error) => settle(`could not start ${command}: ${error.message}`))
    child.stdin.on("error", () => undefined)
    child.stdin.end(`${JSON.stringify(job)}\n`)
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-2_000)
      process.stderr.write(chunk.replace(/^(?=.)/gm, `[${name}] `))
    })
    const onLine = (line: string) => {
      const decoded = decodeCheckpoint(line)
      if (Exit.isFailure(decoded)) {
        console.error(`[${name}] invalid checkpoint: ${line.slice(0, 200)}`)
        return
      }
      const checkpoint = decoded.value
      if (dataCheckpoints.has(checkpoint.type)) {
        if (outputBytes + line.length > LIMITS.resultBytes) {
          outputTruncated = true
          return
        }
        outputBytes += line.length
      }
      if (checkpoint.type === "engine") launched = true
      if (checkpoint.type === "launch-failed") launchFailure = checkpoint.message
      checkpoints.push(checkpoint)
      if (checkpoint.type === "done") {
        sawDone = true
        tree?.kill()
      }
    }
    readLines(child.stdout, LIMITS.lineBytes, onLine, () => {
      outputTruncated = true
      console.error(`[${name}] dropped a checkpoint line over ${LIMITS.lineBytes} bytes`)
    })
    child.on("close", (code, signal) =>
      settle(
        `the engine exited (${signal ?? `code ${code}`})${stderrTail ? `: ${stderrTail.trim().split("\n").at(-1)}` : ""}`,
      ),
    )
  })

const originOf = (url: string) => (URL.canParse(url) ? new URL(url).origin : url)

const refusedBy = (refusals: ReadonlyArray<Refusal>, url: string) =>
  refusals.some((refusal) =>
    refusal.url === null ? refusal.origin === originOf(url) : refusal.url === url,
  )

const assemble = (
  run: EngineRun,
  engine: { name: EngineName; fallbackReason: string | null },
  egress: {
    readonly refusals: ReadonlyArray<Refusal>
    readonly blockVendors: boolean
    readonly limitHit: boolean
  },
  at: () => number,
): CaptureResult => {
  // With blockVendors the proxy refuses every vendor host but serves SDK files, so a request to
  // any other vendor URL never left, even one that shows Chromium's internal HSTS 307.
  const neverLeft = (request: CaptureResult["requests"][number]) =>
    (request.status === null && refusedBy(egress.refusals, request.url)) ||
    (egress.blockVendors &&
      URL.canParse(request.url) &&
      isVendorHost(new URL(request.url).hostname) &&
      !isSdkFile(request.url))
  const documents = new Map<string, CaptureResult["documents"][number]>()
  const requests = new Map<string, CaptureResult["requests"][number]>()
  const dataLayer: Array<CaptureResult["dataLayer"][number]> = []
  const cookies: Array<CaptureResult["cookies"][number]> = []
  const errors: CaptureError[] = []
  let version = "unknown"
  let consent: CaptureResult["consent"] = {
    cmp: null,
    outcome: "none",
    actionAt: null,
    completedAt: null,
    observations: [],
  }
  let screenshot: string | null = null
  let truncated = egress.limitHit || run.outputTruncated
  let done = false

  for (const checkpoint of run.checkpoints) {
    switch (checkpoint.type) {
      case "engine":
        version = checkpoint.version
        break
      case "document":
        documents.set(checkpoint.document.id, checkpoint.document)
        break
      case "requests":
        // A connection the egress proxy refused shows up as a request that got no response.
        for (const request of checkpoint.requests)
          requests.set(
            request.id,
            !request.blocked && neverLeft(request) ? { ...request, blocked: true } : request,
          )
        break
      case "dataLayer":
        dataLayer.push(...checkpoint.entries)
        break
      case "cookies":
        cookies.push(checkpoint.snapshot)
        break
      case "consent":
        consent = checkpoint.consent
        break
      case "screenshot":
        screenshot = checkpoint.data
        break
      case "error":
        errors.push(checkpoint.error)
        break
      case "truncated":
        truncated = true
        break
      case "done":
        done = true
        break
      case "launch-failed":
        break
    }
  }
  if (run.timedOut && !errors.some((error) => error.code === "Timeout"))
    errors.push({ code: "Timeout", message: "the engine was stopped at the time limit", at: at() })
  if (run.crashed !== null && !done && !run.timedOut)
    errors.push({ code: "EngineFailure", message: run.crashed.slice(0, 500), at: at() })
  // The duration limit is a capture limit like the others.
  if (errors.some((error) => error.code === "Timeout")) truncated = true

  return {
    engine: { name: engine.name, version, fallbackReason: engine.fallbackReason },
    documents: [...documents.values()],
    requests: [...requests.values()],
    dataLayer,
    cookies,
    consent: {
      ...consent,
      observations: consent.observations.toSorted((a, b) => a.at - b.at),
    },
    screenshot,
    complete: done && errors.length === 0,
    truncated,
    errors,
  }
}

type CaptureOptions = { readonly allowPrivate: boolean; readonly engine: EngineName }

const capture = async (
  request: CaptureRequest,
  options: CaptureOptions,
): Promise<CaptureResult> => {
  const startedAt = Date.now()
  const deadline =
    startedAt +
    Math.min(
      LIMITS.durationMs + LIMITS.perStepMs * (request.journey?.length ?? 0),
      LIMITS.maxDurationMs,
    )
  const at = () => Date.now() - startedAt
  const proxy = await startEgressProxy({
    allowPrivate: options.allowPrivate,
    blockVendors: request.blockVendorRequests === true,
    maxResponseBytes:
      LIMITS.responseBytes + LIMITS.responseBytesPerStep * (request.journey?.length ?? 0),
    now: at,
  })
  const workDir = await mkdtemp(join(tmpdir(), "zinko-capture-"))
  try {
    const job = (name: EngineName): EngineJob => ({
      request,
      startedAt,
      finalizeAt: deadline - LIMITS.finalizeBeforeMs,
      proxy: proxy.url,
      profileDir: join(workDir, `${name}-profile`),
      files,
      limits: {
        requests: LIMITS.requests,
        bodyBytes: LIMITS.bodyBytes,
        dataLayer: LIMITS.dataLayer,
      },
    })
    let engine: { name: EngineName; fallbackReason: string | null } =
      options.engine === "playwright"
        ? { name: "playwright", fallbackReason: "CAPTURE_ENGINE=playwright" }
        : { name: "scrapling", fallbackReason: null }
    let run = await runEngine(engine.name, job(engine.name), deadline)
    if (
      engine.name === "scrapling" &&
      run.launchFailure !== null &&
      deadline - Date.now() > MIN_FALLBACK_MS
    ) {
      console.error(`scrapling failed to launch, falling back to playwright: ${run.launchFailure}`)
      engine = {
        name: "playwright",
        fallbackReason: `scrapling failed to launch: ${run.launchFailure}`,
      }
      run = await runEngine(engine.name, job(engine.name), deadline)
    }
    const refused = new Set(proxy.refusals.map((refusal) => refusal.origin))
    console.error(
      `egress: contacted ${[...proxy.contacted].join(" ") || "(none)"}; refused ${[...refused].join(" ") || "(none)"}`,
    )
    return assemble(
      run,
      engine,
      {
        refusals: proxy.refusals,
        blockVendors: request.blockVendorRequests === true,
        limitHit: proxy.limitHit(),
      },
      at,
    )
  } finally {
    proxy.close()
    await rm(workDir, { recursive: true, force: true })
  }
}

/** Never rejects: a capture that cannot even be set up is still a result, with the reason. */
export const runCapture = (
  request: CaptureRequest,
  options: CaptureOptions,
): Promise<CaptureResult> =>
  capture(request, options).catch((error: unknown) =>
    assemble(
      {
        checkpoints: [],
        launchFailure: null,
        timedOut: false,
        outputTruncated: false,
        crashed: `the capture could not start: ${error instanceof Error ? error.message : String(error)}`,
      },
      { name: options.engine, fallbackReason: null },
      { refusals: [], blockVendors: false, limitHit: false },
      () => 0,
    ),
  )
