import { CaptureResult } from "@repo/capture-contract"
import { Storage } from "@repo/core"
import { Database } from "@repo/core/Database"
import { audit, hit, run } from "@repo/db"
import { and, eq } from "drizzle-orm"
import { Effect, Option, Result, Schema } from "effect"
import { isUuid, NotFound } from "./server-fn"

/*
 * Reading an audit's runs for the Hits explorer and the Findings screen. Everything is reached
 * through the audit, checked against the organization: another organization's id is a 404.
 */

export const Params = Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Finite]))
export const Ids = Schema.Record(Schema.String, Schema.String)
const ConsentState = Schema.Literals(["granted", "denied", "unknown"])
export const HitConsent = Schema.Struct({
  adStorage: ConsentState,
  analyticsStorage: ConsentState,
  raw: Schema.optionalKey(Schema.String),
})
export const decodeHitColumns = Schema.decodeUnknownEffect(
  Schema.Struct({ params: Params, ids: Ids, consent: HitConsent }),
)

const decodeStoredCapture = Schema.decodeUnknownEffect(Schema.fromJsonString(CaptureResult))

/** The audit's id when it belongs to the organization; another organization's is a 404. */
export const auditInOrg = (orgId: string, id: string) =>
  Effect.gen(function* () {
    if (!isUuid(id)) return yield* new NotFound({ message: "Not found" })
    const { db } = yield* Database
    const [found] = yield* db
      .select({ id: audit.id })
      .from(audit)
      .where(and(eq(audit.id, id), eq(audit.orgId, orgId)))
      .limit(1)
    if (found === undefined) return yield* new NotFound({ message: "Not found" })
    return found.id
  })

/** A run of an audit already checked with `auditInOrg`. */
export const runInAudit = (orgId: string, auditId: string, id: string) =>
  Effect.gen(function* () {
    if (!isUuid(id)) return yield* new NotFound({ message: "Not found" })
    const { db } = yield* Database
    const [found] = yield* db
      .select({ id: run.id, captureKey: run.captureKey, screenshotKey: run.screenshotKey })
      .from(run)
      .where(and(eq(run.id, id), eq(run.auditId, auditId), eq(run.orgId, orgId)))
      .limit(1)
    if (found === undefined) return yield* new NotFound({ message: "Not found" })
    return found
  })

/** The run's stored `capture.json`; a run without one is a 404. */
export const readCapture = (captureKey: string | null) =>
  Effect.gen(function* () {
    if (captureKey === null) return yield* new NotFound({ message: "Not found" })
    const storage = yield* Storage
    const stored = yield* storage.get(captureKey).pipe(Effect.orDie)
    if (Option.isNone(stored)) return yield* new NotFound({ message: "Not found" })
    const text = yield* Effect.promise(() => new Response(stored.value.body).text())
    return yield* decodeStoredCapture(text).pipe(Effect.orDie)
  })

export type CaptureRead =
  | { found: true; capture: CaptureResult }
  | { found: false; reason: "missing" | "storage" | "body" | "decode" }

/**
 * The run's stored capture for a caller that can do without it: it never fails. A null key or an
 * absent object is `missing`, a storage error `storage`, an unreadable body `body` and a capture
 * that does not decode `decode`. Each miss logs one warning with the reason and the run id, never
 * content. The strict `readCapture` stays for screens that need the capture.
 */
export const readCaptureTolerant = (captureKey: string | null, runId: string) =>
  Effect.gen(function* () {
    const miss = (reason: "missing" | "storage" | "body" | "decode") =>
      Effect.logWarning("capture not readable", { reason, runId }).pipe(
        Effect.as({ found: false, reason } satisfies CaptureRead),
      )
    if (captureKey === null) return yield* miss("missing")
    const storage = yield* Storage
    const stored = yield* storage.get(captureKey).pipe(Effect.result)
    if (Result.isFailure(stored)) return yield* miss("storage")
    if (Option.isNone(stored.success)) return yield* miss("missing")
    const { body } = stored.success.value
    const text = yield* Effect.tryPromise(() => new Response(body).text()).pipe(Effect.result)
    if (Result.isFailure(text)) return yield* miss("body")
    const decoded = yield* decodeStoredCapture(text.success).pipe(Effect.result)
    if (Result.isFailure(decoded)) return yield* miss("decode")
    return { found: true, capture: decoded.success } satisfies CaptureRead
  })

/** A hit of the run, by its natural key, with the raw request it was decoded from. */
export const hitWithRequest = (
  orgId: string,
  runId: string,
  capture: CaptureResult,
  requestId: string,
  batchIndex: number,
) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const [row] = yield* db
      .select()
      .from(hit)
      .where(
        and(
          eq(hit.runId, runId),
          eq(hit.orgId, orgId),
          eq(hit.requestId, requestId),
          eq(hit.batchIndex, batchIndex),
        ),
      )
      .limit(1)
    const request = capture.requests.find((r) => r.id === requestId)
    if (row === undefined || request === undefined)
      return yield* new NotFound({ message: "Not found" })
    const columns = yield* decodeHitColumns(row).pipe(Effect.orDie)
    return {
      hit: {
        requestId: row.requestId,
        batchIndex: row.batchIndex,
        documentId: row.documentId,
        at: row.at,
        vendor: row.vendor,
        destinationId: row.destinationId,
        event: row.event,
        host: row.host,
        url: row.url,
        blocked: row.blocked,
        status: row.status,
        afterConsentAction: row.afterConsentAction,
        ...columns,
      },
      request,
    }
  })
