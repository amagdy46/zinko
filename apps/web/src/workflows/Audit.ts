import { DECODER_VERSION } from "@ovriq/zinko-decoders"
import { type CaptureRejected, CaptureResult, Scenario } from "@repo/capture-contract"
import {
  AuditConfig,
  type AuditEvent,
  AuditProgress,
  Browser,
  type BrowserError,
  CaptureAdmission,
  type Grant,
  ENGINE_FREE_EVENT,
  JOURNEY_STEPS,
  Storage,
  StorageError,
} from "@repo/core"
import { Database } from "@repo/core/Database"
import { audit, checkResult, datalayerPush, finding, hit, run, site } from "@repo/db"
import { decodeHits, evaluateRun, RULES_VERSION, ruleById } from "@repo/rules"
import { and, asc, eq, sql } from "drizzle-orm"
import { Data, Effect, Layer, Option, Schema } from "effect"
import { Workflow } from "effect-cf"
import { findingsFrom } from "../lib/findings-from"
import { runtime } from "../server/runtime"
import { AuditWorkflow } from "./AuditWorkflow"

/** The audit or one of its runs is not in the database, or not in the state this step needs. */
class AuditStateError extends Data.TaggedError("AuditStateError")<{ readonly message: string }> {}

const ENGINE_BUSY = "EngineBusy"

/**
 * The engine was busy (429) or no container could start (503): Zinko lacked capacity, the page is
 * not to blame. Cloudflare hands only the message of a step's last error back to the workflow, so
 * the message carries the code.
 */
class EngineBusy extends Data.TaggedError("EngineBusy")<{ readonly message: string }> {}

/** Retrying cannot fix these, so the step ends at once instead of backing off for an hour. */
const failFast = (cause: AuditStateError | Schema.SchemaError) =>
  Effect.fail(new Workflow.WorkflowStepNonRetryableError({ cause }))

interface RunError {
  readonly code: string
  readonly message: string
}

interface StoredKeys {
  readonly captureKey: string
  readonly screenshotKey: string | null
}

/**
 * How one attempt of `capture-<n>` ended. Step results are stored by Cloudflare (1 MiB at most),
 * so a capture travels as its R2 keys. `Lost`: the grant no longer held the engine, so nothing was
 * captured. `Retry`: the engine failed and was given back.
 */
type Attempt = Data.TaggedEnum<{
  Stored: StoredKeys
  Refused: RunError
  Lost: {}
  Retry: RunError
}>
const Attempt = Data.taggedEnum<Attempt>()

/** How a run's capture ended. `Exhausted`: out of turns or retries, or not retryable. */
type CaptureOutcome = Data.TaggedEnum<{
  Captured: StoredKeys
  Rejected: RunError
  Exhausted: RunError
}>
const { Captured, Rejected, Exhausted, $match, $is } = Data.taggedEnum<CaptureOutcome>()

/** Why a run has no persisted capture: the engine refused it, or a step ran out of retries. */
interface RunFailure {
  readonly code: string
  readonly message: string
  /** `EngineFailure`, `EngineBusy` or `PersistFailure`; `null` when the engine refused the request. */
  readonly failure: string | null
}

// Database and storage failures clear up within minutes, so wait 15 s, 30 s, 1 min, ... (about
// an hour in all) before giving the step up.
const STEP = {
  retries: { limit: 8, delay: "15 seconds", backoff: "exponential" },
  timeout: "4 minutes",
} as const

// An attempt of `capture-<n>` always gives its engine back when it ends, so a retried attempt
// finds its grant gone and the run joins the line again (`Lost`); retrying here only covers a
// crash after the capture was stored. The engine stops a capture at 60 s plus 15 s per journey
// step, 150 s at JOURNEY_STEPS and a reload (200 s at most, whatever the steps), well inside the
// timeout.
const CAPTURE_STEP = {
  retries: { limit: 3, delay: "5 seconds", backoff: "constant" },
  timeout: "4 minutes",
} as const

// Turns a run gets on an engine (each `Lost` or `Retry` uses one); after a `Retry` it waits
// 15 s, 30 s, 1 min, 2 min before asking again, off the engine.
const TURNS = 5
// A busy engine frees within a capture (at most 135 s), so a busy run asks again soon and gives up
// after 5 s, 10 s, 20 s and 30 s (65 s) instead of idling for minutes. A run that is still busy
// then is asked once more after every other run has had its turn (`captureRun` with `pass` 1).
const backoff = (turn: number, code: string) =>
  code === ENGINE_BUSY ? Math.min(5_000 * 2 ** turn, 30_000) : 15_000 * 2 ** turn

// The gate is a Durable Object call: retry briefly, and treat a gate that stays down like a busy
// engine (the run records EngineBusy: Zinko was busy).
const ADMIT_STEP = {
  retries: { limit: 5, delay: "2 seconds", backoff: "exponential" },
  timeout: "30 seconds",
} as const

// Postgres takes at most 65,535 parameters per statement; a hit row has 18.
const INSERT_BATCH = 1000

const truncate = (message: string) => message.slice(0, 500)

const keysFor = (auditId: string, runId: string) => ({
  capture: `audits/${auditId}/runs/${runId}/capture.json`,
  screenshot: `audits/${auditId}/runs/${runId}/screenshot.png`,
})

/** Progress is a courtesy to open tabs, which refetch anyway: it never fails or stalls a step. */
const publish = (auditId: string, event: AuditEvent) =>
  Effect.gen(function* () {
    const progress = yield* AuditProgress
    yield* progress.publish(auditId, event)
  }).pipe(
    Effect.timeout("5 seconds"),
    Effect.ignoreCause({ log: "Warn", message: "Audit progress not published" }),
  )

const decodeConfig = Schema.decodeUnknownEffect(AuditConfig)
const decodeRunShape = Schema.decodeUnknownEffect(
  Schema.Struct({ scenario: Scenario, viewport: Schema.Literals(["desktop", "mobile"]) }),
)
const decodeStoredCapture = Schema.decodeUnknownEffect(Schema.fromJsonString(CaptureResult))

const loadRun = (auditId: string, runId: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const [found] = yield* db
      .select({ run, config: audit.config, host: site.host })
      .from(run)
      .innerJoin(audit, eq(audit.id, run.auditId))
      .innerJoin(site, eq(site.id, audit.siteId))
      .where(and(eq(run.id, runId), eq(run.auditId, auditId)))
      .limit(1)
    if (found === undefined)
      return yield* new AuditStateError({ message: `run ${runId} of audit ${auditId} not found` })
    return found
  })

const exists = (key: string) =>
  Effect.gen(function* () {
    const storage = yield* Storage
    return Option.isSome(yield* storage.head(key))
  })

const readText = (key: string) =>
  Effect.gen(function* () {
    const storage = yield* Storage
    const found = yield* storage.get(key)
    if (Option.isNone(found))
      return yield* new AuditStateError({ message: `stored capture ${key} is missing` })
    return yield* Effect.tryPromise({
      try: () => new Response(found.value.body).text(),
      catch: (cause) => new StorageError({ operation: "read", cause }),
    })
  })

/**
 * Which engine errors are worth another turn. A refusal is an answer, not an error; a retry gives
 * the engine back and joins the line again after a backoff, instead of retrying on an engine the
 * run may no longer hold.
 */
const classify = (
  error: BrowserError,
): Effect.Effect<
  CaptureRejected | { readonly retry: RunError },
  Workflow.WorkflowStepNonRetryableError
> => {
  // a refused request captured nothing and would be refused again: no retry
  if (error.rejected !== undefined) return Effect.succeed(error.rejected)
  // a 400 whose body is not a CaptureRejected: the same request fails the same way
  if (error.status === 400)
    return Effect.fail(new Workflow.WorkflowStepNonRetryableError({ cause: error }))
  if (error.status === 429 || error.status === 503)
    return Effect.succeed({
      retry: { code: ENGINE_BUSY, message: `${ENGINE_BUSY}: the engine answered ${error.status}` },
    })
  return Effect.succeed({
    retry: { code: "EngineFailure", message: truncate(`EngineFailure: ${String(error.cause)}`) },
  })
}

const fromBase64 = (data: string) => Uint8Array.from(atob(data), (c) => c.charCodeAt(0))

/** Lists the audit's runs. The audit stays `queued` until it is admitted to an engine. */
const start = (auditId: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const found = yield* db.select({ id: audit.id }).from(audit).where(eq(audit.id, auditId))
    if (found.length === 0)
      return yield* new AuditStateError({ message: `audit ${auditId} not found` })
    return yield* db
      .select({ id: run.id, ordinal: run.ordinal })
      .from(run)
      .where(eq(run.auditId, auditId))
      .orderBy(asc(run.ordinal))
  }).pipe(Effect.catchTag("AuditStateError", failFast))

/**
 * Asks the gate for an engine for one capture. The first grant marks the audit running.
 */
const admit = (auditId: string, turn: string) =>
  Effect.gen(function* () {
    const gate = yield* CaptureAdmission
    const admission = yield* gate.admit(auditId, turn)
    if (!("engine" in admission)) return admission
    const { db } = yield* Database
    const started = yield* db
      .update(audit)
      .set({ status: "running", startedAt: sql`coalesce(${audit.startedAt}, now())` })
      .where(and(eq(audit.id, auditId), eq(audit.status, "queued")))
      .returning({ id: audit.id })
    if (started.length > 0) yield* publish(auditId, { type: "audit", status: "running" })
    return admission
  }).pipe(
    Effect.catchTag("AdmissionError", (error) =>
      Effect.logWarning("Capture admission failed", error).pipe(
        Effect.andThen(
          Effect.fail(
            new EngineBusy({ message: `${ENGINE_BUSY}: the capture queue did not answer` }),
          ),
        ),
      ),
    ),
  )

/**
 * Waits for a grant: `admit-<turn>` asks; while the audit waits, `queued-<turn>-<k>` sleeps until
 * the gate wakes it or a minute passes, and `admit-<turn>-<k>` asks again.
 */
const grantFor = (auditId: string, turn: string) =>
  Effect.gen(function* () {
    for (let attempt = 0; ; attempt++) {
      const admission = yield* Workflow.step(
        attempt === 0 ? `admit-${turn}` : `admit-${turn}-${attempt}`,
        runtime.provide(admit(auditId, turn)),
        ADMIT_STEP,
      )
      if ("engine" in admission) return admission
      yield* Effect.logInfo(
        `Audit ${auditId} waits for an engine at position ${admission.position}`,
      )
      // a timeout is the periodic re-ask, not a failure
      yield* Workflow.waitForEvent(`queued-${turn}-${attempt + 1}`, {
        type: ENGINE_FREE_EVENT,
        timeout: "1 minute",
      }).pipe(Effect.catchTag("WorkflowStepError", () => Effect.void))
    }
  })

/** A cross-host run only follows its link; a journey run walks the key pages, then reloads when asked. */
const journeyOf = (
  current: { journey: boolean; followHost: string | null },
  pages: ReadonlyArray<string>,
  reload: boolean,
) => {
  if (current.followHost !== null)
    return { journey: [{ action: "follow" as const, host: current.followHost }] }
  if (!current.journey) return {}
  return {
    journey: [
      ...pages.slice(1, 1 + JOURNEY_STEPS).map((url) => ({ action: "goto" as const, url })),
      ...(reload ? [{ action: "reload" as const }] : []),
    ],
  }
}

/**
 * Captures one run on the engine `grant` holds and stores it in R2, at most once: a run that
 * already has its keys, or whose capture is already in R2 (written before a database failure), is
 * not captured again. The gate confirms the grant before the engine is called, so an attempt that
 * runs after its grant lapsed (a retry, a resumed workflow) captures nothing; every attempt gives
 * the engine back when it ends.
 */
const capture = (auditId: string, runId: string, grant: Grant) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const storage = yield* Storage
    const gate = yield* CaptureAdmission
    const { run: current, config, host } = yield* loadRun(auditId, runId)
    if (current.captureKey !== null)
      return Attempt.Stored({
        captureKey: current.captureKey,
        screenshotKey: current.screenshotKey,
      })
    const keys = keysFor(auditId, runId)
    const storeKeys = (screenshotKey: string | null) =>
      db
        .update(run)
        .set({
          captureKey: keys.capture,
          screenshotKey,
          finishedAt: sql`coalesce(${run.finishedAt}, now())`,
        })
        .where(eq(run.id, runId))
        .pipe(Effect.as(Attempt.Stored({ captureKey: keys.capture, screenshotKey })))
    // the screenshot is written first, so a stored capture.json means its screenshot is stored too
    if (yield* exists(keys.capture))
      return yield* storeKeys((yield* exists(keys.screenshot)) ? keys.screenshot : null)

    const { blockVendorRequests, measuredHosts, pages, reload } = yield* decodeConfig(config)
    const { scenario, viewport } = yield* decodeRunShape(current)
    yield* db
      .update(run)
      .set({ status: "running", startedAt: sql`coalesce(${run.startedAt}, now())` })
      .where(eq(run.id, runId))
    yield* publish(auditId, {
      type: "run",
      runId,
      ordinal: current.ordinal,
      status: "running",
      hitCount: 0,
      errors: [],
    })
    const browser = yield* Browser
    // A run that gives its turn back is waiting for a slot, not running: say so, and time its
    // next attempt from its own start.
    const requeue = <A>(attempt: A) =>
      db
        .update(run)
        .set({ status: "pending", startedAt: null })
        .where(eq(run.id, runId))
        .pipe(
          Effect.andThen(
            publish(auditId, {
              type: "run",
              runId,
              ordinal: current.ordinal,
              status: "pending",
              hitCount: 0,
              errors: [],
            }),
          ),
          Effect.as(attempt),
        )
    if (!(yield* gate.confirm(auditId, grant))) return yield* requeue(Attempt.Lost())
    const answer = yield* browser
      .capture(
        {
          url: current.pageUrl,
          scenario,
          viewport,
          ...journeyOf(current, pages, reload === true),
          blockVendorRequests,
          allowedHosts: [host, ...(measuredHosts ?? [])],
        },
        { instance: grant.engine },
      )
      .pipe(Effect.catchTag("BrowserError", classify))
    if ("retry" in answer) return yield* requeue(Attempt.Retry(answer.retry))
    if ("error" in answer)
      return Attempt.Refused({ code: answer.error, message: truncate(answer.message) })

    if (answer.screenshot !== null)
      yield* storage.put(keys.screenshot, fromBase64(answer.screenshot), {
        contentType: "image/png",
      })
    yield* storage.put(keys.capture, JSON.stringify({ ...answer, screenshot: null }), {
      contentType: "application/json",
    })
    return yield* storeKeys(answer.screenshot === null ? null : keys.screenshot)
  }).pipe(
    Effect.ensuring(
      Effect.gen(function* () {
        const gate = yield* CaptureAdmission
        yield* gate.release(auditId, grant)
      }).pipe(
        // if this fails the grant stays until the audit's next admit drops it or the lease lapses
        Effect.ignoreCause({ log: "Warn", message: "Engine not released" }),
      ),
    ),
    Effect.catchTags({
      AuditStateError: failFast,
      SchemaError: failFast,
      AdmissionError: () =>
        Effect.fail(
          new EngineBusy({ message: `${ENGINE_BUSY}: the capture queue did not answer` }),
        ),
    }),
  )

/**
 * One run's turns on an engine: wait for a grant, capture on it. A turn that lost its grant asks
 * again at once; one whose engine failed waits a backoff off the engine first. Turn 0's steps are
 * `admit-<n>` and `capture-<n>`, turn t's `admit-<n>.<t>` and `capture-<n>.<t>`, so a new turn
 * never replays an old grant. The second pass over busy runs uses `<n>r` in place of `<n>`.
 */
const captureRun = (auditId: string, runId: string, ordinal: number, pass: 0 | 1) =>
  Effect.gen(function* () {
    const base = pass === 0 ? `${ordinal}` : `${ordinal}r`
    for (let turn = 0; ; turn++) {
      const name = turn === 0 ? base : `${base}.${turn}`
      const grant = yield* grantFor(auditId, name)
      const outcome = yield* Workflow.step(
        `capture-${name}`,
        runtime.provide(capture(auditId, runId, grant)),
        CAPTURE_STEP,
      )
      if (Attempt.$is("Stored")(outcome))
        return Captured({ captureKey: outcome.captureKey, screenshotKey: outcome.screenshotKey })
      if (Attempt.$is("Refused")(outcome))
        return Rejected({ code: outcome.code, message: outcome.message })
      const retry = Attempt.$is("Retry")(outcome)
      if (turn + 1 >= TURNS)
        return Exhausted(
          retry
            ? { code: outcome.code, message: outcome.message }
            : {
                code: ENGINE_BUSY,
                message: `${ENGINE_BUSY}: the engine was handed on before the capture started`,
              },
        )
      if (retry) yield* Workflow.sleep(`backoff-${name}`, backoff(turn, outcome.code))
    }
  })

/**
 * Derives the run's hits, `dataLayer` pushes and check results from its stored capture. One
 * transaction deletes what an earlier attempt wrote and inserts again; keys and `created_at` (the
 * run's `finished_at`) come from the capture and the rules are pure, so every attempt writes
 * identical rows.
 */
const persist = (auditId: string, runId: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const { run: current, config, host } = yield* loadRun(auditId, runId)
    const { measuredHosts } = yield* decodeConfig(config)
    if (current.captureKey === null || current.finishedAt === null)
      return yield* new AuditStateError({ message: `run ${runId} has no stored capture` })
    const result = yield* decodeStoredCapture(yield* readText(current.captureKey))
    const { scenario, viewport } = yield* decodeRunShape(current)
    const createdAt = current.finishedAt
    const { outcome, actionAt } = result.consent
    // An action that did not take effect (`not-applied`) gave no consent, so it splits nothing.
    const consentLine = outcome === "accepted" || outcome === "rejected" ? actionAt : null
    const requests = new Map(result.requests.map((request) => [request.id, request]))
    const decoded = decodeHits(result)
    const hits = decoded.flatMap((found) => {
      const request = requests.get(found.requestId)
      if (request === undefined) return []
      return [
        {
          orgId: current.orgId,
          createdAt,
          runId,
          requestId: found.requestId,
          batchIndex: found.batchIndex,
          documentId: found.documentId,
          at: Math.round(found.startedAt),
          vendor: found.vendor,
          destinationId: found.destinationId,
          event: found.event,
          params: found.params,
          ids: found.ids,
          consent: found.consent,
          host: found.host,
          url: found.url,
          blocked: request.blocked,
          status: request.status === null ? null : Math.round(request.status),
          // gtag sends what Consent Mode held within milliseconds of the click, before autoconsent
          // reports completion, so the action's start (accept or reject) is the line, not completedAt
          afterConsentAction: consentLine !== null && found.startedAt >= consentLine,
        },
      ]
    })
    const results = evaluateRun({
      scenario,
      viewport,
      pageUrl: current.pageUrl,
      siteHost: host,
      measuredHosts: measuredHosts ?? [],
      journey: current.journey,
      capture: result,
      hits: decoded,
    })
    const checks = yield* Effect.forEach(results, (check) => {
      const rule = ruleById(check.ruleId)
      if (rule === undefined)
        return Effect.fail(new AuditStateError({ message: `rule ${check.ruleId} is not listed` }))
      return Effect.succeed({
        runId,
        orgId: current.orgId,
        ruleId: check.ruleId,
        rulesVersion: RULES_VERSION,
        status: check.status,
        message: check.message,
        evidence: check.evidence,
        area: rule.area,
        severity: rule.severity,
        title: rule.title,
        checkTitle: rule.checkTitle,
        owner: rule.owner,
        why: rule.why,
        fix: rule.fix,
        createdAt,
      })
    })
    const pushes = result.dataLayer.map((push, seq) => ({
      orgId: current.orgId,
      createdAt,
      runId,
      seq,
      documentId: push.documentId,
      at: Math.round(push.at),
      value: push.value,
    }))
    const status = result.complete ? "complete" : "partial"
    yield* db.$client.withTransaction(
      Effect.gen(function* () {
        yield* db.delete(hit).where(eq(hit.runId, runId))
        yield* db.delete(datalayerPush).where(eq(datalayerPush.runId, runId))
        yield* db.delete(checkResult).where(eq(checkResult.runId, runId))
        for (let i = 0; i < hits.length; i += INSERT_BATCH)
          yield* db.insert(hit).values(hits.slice(i, i + INSERT_BATCH))
        for (let i = 0; i < pushes.length; i += INSERT_BATCH)
          yield* db.insert(datalayerPush).values(pushes.slice(i, i + INSERT_BATCH))
        yield* db.insert(checkResult).values(checks)
        yield* db
          .update(run)
          .set({
            status,
            failure: null,
            engine: result.engine,
            decoderVersion: DECODER_VERSION,
            consent: result.consent,
            documents: result.documents,
            cookies: result.cookies,
            errors: result.errors,
            complete: result.complete,
            truncated: result.truncated,
            hitCount: hits.length,
          })
          .where(eq(run.id, runId))
      }),
    )
    return yield* publish(auditId, {
      type: "run",
      runId,
      ordinal: current.ordinal,
      status,
      hitCount: hits.length,
      errors: result.errors.map(({ code, message }) => ({ code, message })),
    })
  }).pipe(Effect.catchTags({ AuditStateError: failFast, SchemaError: failFast }))

/**
 * Records a run that has no persisted capture, and removes anything a `persist` attempt left. A
 * stored capture (`PersistFailure`) is kept.
 */
const fail = (auditId: string, runId: string, reason: RunFailure) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const errors = [{ code: reason.code, message: reason.message }]
    const updated = yield* db.$client.withTransaction(
      Effect.gen(function* () {
        yield* db.delete(hit).where(eq(hit.runId, runId))
        yield* db.delete(datalayerPush).where(eq(datalayerPush.runId, runId))
        yield* db.delete(checkResult).where(eq(checkResult.runId, runId))
        return yield* db
          .update(run)
          .set({
            status: "failed",
            failure: reason.failure,
            errors,
            hitCount: 0,
            finishedAt: sql`coalesce(${run.finishedAt}, now())`,
          })
          .where(and(eq(run.id, runId), eq(run.auditId, auditId)))
          .returning({ ordinal: run.ordinal })
      }),
    )
    const [found] = updated
    if (found === undefined)
      return yield* new AuditStateError({ message: `run ${runId} of audit ${auditId} not found` })
    return yield* publish(auditId, {
      type: "run",
      runId,
      ordinal: found.ordinal,
      status: "failed",
      hitCount: 0,
      errors,
    })
  }).pipe(Effect.catchTag("AuditStateError", failFast))

/** `complete` when every run is; `failed` when no run has a capture; `partial` otherwise. */
const auditStatus = (runs: ReadonlyArray<{ status: string; captureKey: string | null }>) => {
  if (runs.every((r) => r.status === "complete")) return "complete"
  if (runs.every((r) => r.captureKey === null)) return "failed"
  return "partial"
}

/**
 * Settles the audit's status and recomputes its findings from its runs' check results, in one
 * transaction: a retry replaces them with the same rows. Triage is never touched.
 */
const finish = (auditId: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const settled = yield* db.$client.withTransaction(
      Effect.gen(function* () {
        const runs = yield* db
          .select({ status: run.status, captureKey: run.captureKey })
          .from(run)
          .where(eq(run.auditId, auditId))
        const status = auditStatus(runs)
        const checks = yield* db
          .select({
            runId: checkResult.runId,
            orgId: checkResult.orgId,
            ruleId: checkResult.ruleId,
            rulesVersion: checkResult.rulesVersion,
            status: checkResult.status,
            area: checkResult.area,
            severity: checkResult.severity,
            title: checkResult.title,
            checkTitle: checkResult.checkTitle,
            owner: checkResult.owner,
            why: checkResult.why,
            fix: checkResult.fix,
          })
          .from(checkResult)
          .innerJoin(run, eq(run.id, checkResult.runId))
          .where(eq(run.auditId, auditId))
          .orderBy(asc(run.ordinal), asc(checkResult.ruleId))
        const findings = findingsFrom(auditId, checks)
        yield* db.delete(finding).where(eq(finding.auditId, auditId))
        if (findings.length > 0) yield* db.insert(finding).values(findings)
        yield* db
          .update(audit)
          .set({ status, finishedAt: sql`coalesce(${audit.finishedAt}, now())` })
          .where(eq(audit.id, auditId))
        return status
      }),
    )
    yield* publish(auditId, { type: "audit", status: settled })
    return settled
  })

/**
 * One audit: `start`, then for each run `admit-<n>` and `capture-<n>` (repeated as
 * `admit-<n>.<t>`, `capture-<n>.<t>` when a turn was lost or failed), then `persist-<n>` or
 * `fail-<n>`, then `finish`. Every step is durable: once it succeeds, a replay returns its stored
 * result instead of running it again. A run that fails does not stop the audit. Bound as
 * AUDIT_WORKFLOW, exported from `src/server.ts`.
 */
export class Audit extends AuditWorkflow.make(Layer.empty, {
  run: ({ auditId }) =>
    Effect.gen(function* () {
      const runs = yield* Workflow.step("start", runtime.provide(start(auditId)), STEP)
      const settle = (id: string, ordinal: number, outcome: CaptureOutcome) =>
        Effect.gen(function* () {
          const reason = yield* $match(outcome, {
            Captured: () =>
              Workflow.step(`persist-${ordinal}`, runtime.provide(persist(auditId, id)), STEP).pipe(
                Effect.as(null),
                Effect.catchTag("WorkflowStepError", (error) =>
                  Effect.succeed<RunFailure>({
                    code: "PersistFailure",
                    message: truncate(error.message),
                    failure: "PersistFailure",
                  }),
                ),
              ),
            Rejected: ({ code, message }) =>
              Effect.succeed<RunFailure>({ code, message, failure: null }),
            Exhausted: ({ code, message }) =>
              Effect.succeed<RunFailure>({ code, message, failure: code }),
          })
          if (reason !== null)
            yield* Workflow.step(
              `fail-${ordinal}`,
              runtime.provide(fail(auditId, id, reason)),
              STEP,
            )
        })
      const attempt = (id: string, ordinal: number, pass: 0 | 1) =>
        // effect-cf fails the step with WorkflowStepError once Cloudflare gives up retrying
        captureRun(auditId, id, ordinal, pass).pipe(
          Effect.catchTag("WorkflowStepError", (error) =>
            Effect.succeed(
              Exhausted({
                code: error.message.includes(ENGINE_BUSY) ? ENGINE_BUSY : "EngineFailure",
                message: truncate(error.message),
              }),
            ),
          ),
        )
      const busy: Array<{ id: string; ordinal: number }> = []
      for (const { id, ordinal } of runs) {
        const outcome = yield* attempt(id, ordinal, 0)
        // a run that found the engine busy waits for the others, then asks again before it fails
        if ($is("Exhausted")(outcome) && outcome.code === ENGINE_BUSY) busy.push({ id, ordinal })
        else yield* settle(id, ordinal, outcome)
      }
      for (const { id, ordinal } of busy) yield* settle(id, ordinal, yield* attempt(id, ordinal, 1))
      const status = yield* Workflow.step("finish", runtime.provide(finish(auditId)), STEP)
      return { status }
    }),
}) {}
