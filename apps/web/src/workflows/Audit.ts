import { DECODER_VERSION } from "@ovriq/zinko-decoders"
import { type CaptureRejected, CaptureResult, Scenario } from "@repo/capture-contract"
import {
  AuditConfig,
  type AuditEvent,
  AuditProgress,
  Browser,
  type BrowserError,
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

/**
 * How `capture-<n>` ended. Step results are stored by Cloudflare (1 MiB at most), so a capture
 * travels as its R2 keys. `Exhausted` is the step giving up (out of retries, or not retryable).
 */
type CaptureOutcome = Data.TaggedEnum<{
  Captured: { readonly captureKey: string; readonly screenshotKey: string | null }
  Rejected: { readonly code: string; readonly message: string }
  Exhausted: { readonly code: string; readonly message: string }
}>
const { Captured, Rejected, Exhausted, $match } = Data.taggedEnum<CaptureOutcome>()

/** Why a run has no persisted capture: the engine refused it, or a step ran out of retries. */
interface RunFailure {
  readonly code: string
  readonly message: string
  /** `EngineFailure`, `EngineBusy` or `PersistFailure`; `null` when the engine refused the request. */
  readonly failure: string | null
}

// A busy engine (429) or a container that cannot start (503) clears up within minutes, so wait
// 15 s, 30 s, 1 min, ... (about an hour in all) before giving the run up. The engine stops a
// capture at 60 s plus 15 s per journey step, 135 s at JOURNEY_STEPS, well inside the timeout.
const STEP = {
  retries: { limit: 8, delay: "15 seconds", backoff: "exponential" },
  timeout: "4 minutes",
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

/** Which engine errors are worth retrying. A refusal is an answer, not an error. */
const classify = (
  error: BrowserError,
): Effect.Effect<
  CaptureRejected,
  BrowserError | EngineBusy | Workflow.WorkflowStepNonRetryableError
> => {
  // a refused request captured nothing and would be refused again: no retry
  if (error.rejected !== undefined) return Effect.succeed(error.rejected)
  // a 400 whose body is not a CaptureRejected: the same request fails the same way
  if (error.status === 400)
    return Effect.fail(new Workflow.WorkflowStepNonRetryableError({ cause: error }))
  if (error.status === 429 || error.status === 503)
    return Effect.fail(
      new EngineBusy({ message: `${ENGINE_BUSY}: the engine answered ${error.status}` }),
    )
  return Effect.fail(error)
}

const fromBase64 = (data: string) => Uint8Array.from(atob(data), (c) => c.charCodeAt(0))

/** Marks the audit running and lists its runs. */
const start = (auditId: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const updated = yield* db
      .update(audit)
      .set({ status: "running", startedAt: sql`coalesce(${audit.startedAt}, now())` })
      .where(eq(audit.id, auditId))
      .returning({ id: audit.id })
    if (updated.length === 0)
      return yield* new AuditStateError({ message: `audit ${auditId} not found` })
    const runs = yield* db
      .select({ id: run.id, ordinal: run.ordinal })
      .from(run)
      .where(eq(run.auditId, auditId))
      .orderBy(asc(run.ordinal))
    yield* publish(auditId, { type: "audit", status: "running" })
    return runs
  }).pipe(Effect.catchTag("AuditStateError", failFast))

/**
 * Captures one run and stores it in R2, at most once: a run that already has its keys, or whose
 * capture is already in R2 (written before a database failure), is not captured again.
 */
const capture = (auditId: string, runId: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const storage = yield* Storage
    const { run: current, config, host } = yield* loadRun(auditId, runId)
    if (current.captureKey !== null)
      return Captured({ captureKey: current.captureKey, screenshotKey: current.screenshotKey })
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
        .pipe(Effect.as(Captured({ captureKey: keys.capture, screenshotKey })))
    // the screenshot is written first, so a stored capture.json means its screenshot is stored too
    if (yield* exists(keys.capture))
      return yield* storeKeys((yield* exists(keys.screenshot)) ? keys.screenshot : null)

    const { blockVendorRequests, pages } = yield* decodeConfig(config)
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
    const answer = yield* browser
      .capture(
        {
          url: current.pageUrl,
          scenario,
          viewport,
          ...(current.journey
            ? {
                journey: pages
                  .slice(1, 1 + JOURNEY_STEPS)
                  .map((url) => ({ action: "goto" as const, url })),
              }
            : {}),
          blockVendorRequests,
          allowedHosts: [host],
        },
        { instance: auditId },
      )
      .pipe(Effect.catchTag("BrowserError", classify))
    if ("error" in answer)
      return Rejected({ code: answer.error, message: truncate(answer.message) })

    if (answer.screenshot !== null)
      yield* storage.put(keys.screenshot, fromBase64(answer.screenshot), {
        contentType: "image/png",
      })
    yield* storage.put(keys.capture, JSON.stringify({ ...answer, screenshot: null }), {
      contentType: "application/json",
    })
    return yield* storeKeys(answer.screenshot === null ? null : keys.screenshot)
  }).pipe(Effect.catchTags({ AuditStateError: failFast, SchemaError: failFast }))

/**
 * Derives the run's hits, `dataLayer` pushes and check results from its stored capture. One
 * transaction deletes what an earlier attempt wrote and inserts again; keys and `created_at` (the
 * run's `finished_at`) come from the capture and the rules are pure, so every attempt writes
 * identical rows.
 */
const persist = (auditId: string, runId: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const { run: current, host } = yield* loadRun(auditId, runId)
    if (current.captureKey === null || current.finishedAt === null)
      return yield* new AuditStateError({ message: `run ${runId} has no stored capture` })
    const result = yield* decodeStoredCapture(yield* readText(current.captureKey))
    const { scenario, viewport } = yield* decodeRunShape(current)
    const createdAt = current.finishedAt
    const { actionAt } = result.consent
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
          afterConsentAction: actionAt !== null && found.startedAt >= actionAt,
        },
      ]
    })
    const checks = evaluateRun({
      scenario,
      viewport,
      pageUrl: current.pageUrl,
      siteHost: host,
      journey: current.journey,
      capture: result,
      hits: decoded,
    }).map((check) => ({
      runId,
      orgId: current.orgId,
      ruleId: check.ruleId,
      rulesVersion: RULES_VERSION,
      status: check.status,
      message: check.message,
      evidence: check.evidence,
      createdAt,
    }))
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

interface StoredCheck {
  readonly runId: string
  readonly orgId: string
  readonly ruleId: string
  readonly rulesVersion: string
  readonly status: string
}

/**
 * One finding per rule that failed on at least one run (`fail`), or failed on none and was
 * inconclusive on at least one (`inconclusive`). `checks` are in run order, so `run_ids` are too.
 * The text is the rule's as it reads now. A rule no longer in `@repo/rules` has no text to show
 * and is returned in `unknown` instead.
 */
const findingsFrom = (auditId: string, checks: ReadonlyArray<StoredCheck>) => {
  const byRule = new Map<string, StoredCheck[]>()
  for (const check of checks) {
    const group = byRule.get(check.ruleId) ?? []
    group.push(check)
    byRule.set(check.ruleId, group)
  }
  const findings: Array<typeof finding.$inferInsert> = []
  const unknown: string[] = []
  for (const [ruleId, group] of byRule) {
    const flagged = group.filter((c) => c.status === "fail" || c.status === "inconclusive")
    const [first] = flagged
    if (first === undefined) continue
    const rule = ruleById(ruleId)
    if (rule === undefined) {
      unknown.push(ruleId)
      continue
    }
    const failingRuns = flagged.filter((c) => c.status === "fail").length
    findings.push({
      auditId,
      orgId: first.orgId,
      ruleId,
      kind: failingRuns > 0 ? "fail" : "inconclusive",
      rulesVersions: [...new Set(group.map((c) => c.rulesVersion))].toSorted(),
      area: rule.area,
      severity: rule.severity,
      title: rule.title,
      why: rule.why,
      fix: rule.fix,
      failingRuns,
      inconclusiveRuns: flagged.length - failingRuns,
      runIds: flagged.map((c) => c.runId),
    })
  }
  return { findings, unknown }
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
          })
          .from(checkResult)
          .innerJoin(run, eq(run.id, checkResult.runId))
          .where(eq(run.auditId, auditId))
          .orderBy(asc(run.ordinal), asc(checkResult.ruleId))
        const { findings, unknown } = findingsFrom(auditId, checks)
        yield* db.delete(finding).where(eq(finding.auditId, auditId))
        if (findings.length > 0) yield* db.insert(finding).values(findings)
        yield* db
          .update(audit)
          .set({ status, finishedAt: sql`coalesce(${audit.finishedAt}, now())` })
          .where(eq(audit.id, auditId))
        return { status, unknown }
      }),
    )
    if (settled.unknown.length > 0)
      yield* Effect.logWarning("Check results of unknown rules have no finding", {
        auditId,
        ruleIds: settled.unknown,
      })
    yield* publish(auditId, { type: "audit", status: settled.status })
    return settled.status
  })

/**
 * One audit: `start`, then for each run `capture-<n>` and either `persist-<n>` or `fail-<n>`, then
 * `finish`. Every step is durable: once it succeeds, a replay returns its stored result instead of
 * running it again. A run that fails does not stop the audit. Bound as AUDIT_WORKFLOW, exported
 * from `src/server.ts`.
 */
export class Audit extends AuditWorkflow.make(Layer.empty, {
  run: ({ auditId }) =>
    Effect.gen(function* () {
      const runs = yield* Workflow.step("start", runtime.provide(start(auditId)), STEP)
      for (const { id, ordinal } of runs) {
        // effect-cf fails the step with WorkflowStepError once Cloudflare gives up retrying
        const outcome = yield* Workflow.step(
          `capture-${ordinal}`,
          runtime.provide(capture(auditId, id)),
          STEP,
        ).pipe(
          Effect.catchTag("WorkflowStepError", (error) =>
            Effect.succeed(
              Exhausted({
                code: error.message.includes(ENGINE_BUSY) ? ENGINE_BUSY : "EngineFailure",
                message: truncate(error.message),
              }),
            ),
          ),
        )
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
          yield* Workflow.step(`fail-${ordinal}`, runtime.provide(fail(auditId, id, reason)), STEP)
      }
      const status = yield* Workflow.step("finish", runtime.provide(finish(auditId)), STEP)
      return { status }
    }),
}) {}
