import { CaptureResult } from "@repo/capture-contract"
import { Storage } from "@repo/core"
import { Database } from "@repo/core/Database"
import { audit, datalayerPush, hit, run } from "@repo/db"
import { createServerFn } from "@tanstack/react-start"
import { and, asc, eq, type SQL, sql } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"
import { requireSession } from "./require-session"
import { isUuid, membership, NotFound, read } from "./server-fn"

const PAGE_SIZE = 200

const HIT = 0
const PUSH = 1

const Params = Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Finite]))
const Ids = Schema.Record(Schema.String, Schema.String)
const ConsentState = Schema.Literals(["granted", "denied", "unknown"])
const HitConsent = Schema.Struct({
  adStorage: ConsentState,
  analyticsStorage: ConsentState,
  raw: Schema.optionalKey(Schema.String),
})
const decodeHitColumns = Schema.decodeUnknownEffect(
  Schema.Struct({ params: Params, ids: Ids, consent: HitConsent }),
)
const decodePushValue = Schema.decodeUnknownEffect(Schema.Json)

/**
 * Where a page ends: run ordinal, `at`, kind (hits before pushes), then the hit's `request_id`
 * and `batch_index`, or an empty id and the push's `seq`. It travels as base64 JSON and is
 * validated when it comes back.
 */
const Int4 = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 2_147_483_647 }))
const Cursor = Schema.Tuple([Int4, Int4, Schema.Literals([HIT, PUSH]), Schema.String, Int4])
type Cursor = typeof Cursor.Type
const CursorJson = Schema.fromJsonString(Cursor)
const decodeCursor = Schema.decodeUnknownEffect(CursorJson)
const encodeCursor = Schema.encodeSync(CursorJson)

const toBase64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)))
const fromBase64 = (value: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(value), (c) => c.charCodeAt(0)))

const openCursor = (cursor: string | undefined) =>
  cursor === undefined
    ? Effect.void
    : Effect.try({ try: () => fromBase64(cursor), catch: () => undefined }).pipe(
        Effect.flatMap((json) => decodeCursor(json)),
        Effect.mapError(() => new NotFound({ message: "Not found" })),
      )

/** The audit's id when it belongs to the organization; another organization's is a 404. */
const auditInOrg = (orgId: string, id: string) =>
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

type TimelineItem =
  | {
      kind: "hit"
      runId: string
      ordinal: number
      requestId: string
      batchIndex: number
      documentId: string
      at: number
      vendor: string
      destinationId: string
      event: string
      params: typeof Params.Type
      ids: typeof Ids.Type
      consent: typeof HitConsent.Type
      host: string
      url: string
      blocked: boolean
      status: number | null
      afterConsentAction: boolean
    }
  | {
      kind: "push"
      runId: string
      ordinal: number
      seq: number
      documentId: string
      at: number
      value: Schema.Json
    }

const tupleOf = (item: TimelineItem): Cursor =>
  item.kind === "hit"
    ? [item.ordinal, item.at, HIT, item.requestId, item.batchIndex]
    : [item.ordinal, item.at, PUSH, "", item.seq]

const compareText = (a: string, b: string) => {
  if (a === b) return 0
  return a < b ? -1 : 1
}

/** The order of the query: the same tuple, with ids compared bytewise like `collate "C"`. */
const compare = (a: Cursor, b: Cursor) =>
  a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || compareText(a[3], b[3]) || a[4] - b[4]

const TimelineInput = Schema.Struct({
  auditId: Schema.String,
  runId: Schema.optional(Schema.String),
  vendor: Schema.optional(Schema.String),
  event: Schema.optional(Schema.String),
  scenario: Schema.optional(Schema.String),
  source: Schema.optional(Schema.Literals(["all", "network", "dataLayer"])),
  cursor: Schema.optional(Schema.String),
})

/**
 * One page of an audit's hits and `dataLayer` pushes, interleaved by time. A vendor or event
 * filter applies to hits only; `source` limits the page to hits (`network`) or pushes (`dataLayer`). Runs are reached through the audit.
 */
export const listTimeline = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(TimelineInput))
  .handler(({ context, data }) =>
    read(
      Effect.gen(function* () {
        const { organizationId: orgId } = yield* membership(context.session)
        const auditId = yield* auditInOrg(orgId, data.auditId)
        const after = yield* openCursor(data.cursor)
        const { db } = yield* Database
        const [o, a, k, r, i] = after ?? [0, 0, HIT, "", 0]
        const inRun: SQL[] = [eq(run.auditId, auditId), eq(run.orgId, orgId)]
        if (data.runId !== undefined) {
          if (!isUuid(data.runId)) return { items: [], nextCursor: null }
          inRun.push(eq(run.id, data.runId))
        }
        if (data.scenario !== undefined) inRun.push(eq(run.scenario, data.scenario))

        const hitWhere = [...inRun, eq(hit.orgId, orgId)]
        if (data.vendor !== undefined) hitWhere.push(eq(hit.vendor, data.vendor))
        if (data.event !== undefined) hitWhere.push(eq(hit.event, data.event))
        if (after !== undefined)
          hitWhere.push(
            sql`(${run.ordinal}, ${hit.at}, ${HIT}::int, ${hit.requestId} collate "C", ${hit.batchIndex}) > (${o}::int, ${a}::int, ${k}::int, ${r}::text collate "C", ${i}::int)`,
          )
        const hitRows =
          data.source === "dataLayer"
            ? []
            : yield* db
                .select({
                  runId: hit.runId,
                  ordinal: run.ordinal,
                  requestId: hit.requestId,
                  batchIndex: hit.batchIndex,
                  documentId: hit.documentId,
                  at: hit.at,
                  vendor: hit.vendor,
                  destinationId: hit.destinationId,
                  event: hit.event,
                  params: hit.params,
                  ids: hit.ids,
                  consent: hit.consent,
                  host: hit.host,
                  url: hit.url,
                  blocked: hit.blocked,
                  status: hit.status,
                  afterConsentAction: hit.afterConsentAction,
                })
                .from(hit)
                .innerJoin(run, eq(run.id, hit.runId))
                .where(and(...hitWhere))
                .orderBy(
                  asc(run.ordinal),
                  asc(hit.at),
                  sql`${hit.requestId} collate "C"`,
                  asc(hit.batchIndex),
                )
                .limit(PAGE_SIZE + 1)

        const pushWhere = [...inRun, eq(datalayerPush.orgId, orgId)]
        if (after !== undefined)
          pushWhere.push(
            sql`(${run.ordinal}, ${datalayerPush.at}, ${PUSH}::int, ''::text collate "C", ${datalayerPush.seq}) > (${o}::int, ${a}::int, ${k}::int, ${r}::text collate "C", ${i}::int)`,
          )
        const pushRows =
          data.source === "network"
            ? []
            : yield* db
                .select({
                  runId: datalayerPush.runId,
                  ordinal: run.ordinal,
                  seq: datalayerPush.seq,
                  documentId: datalayerPush.documentId,
                  at: datalayerPush.at,
                  value: datalayerPush.value,
                })
                .from(datalayerPush)
                .innerJoin(run, eq(run.id, datalayerPush.runId))
                .where(and(...pushWhere))
                .orderBy(asc(run.ordinal), asc(datalayerPush.at), asc(datalayerPush.seq))
                .limit(PAGE_SIZE + 1)

        const hits = yield* Effect.forEach(hitRows, (row) =>
          decodeHitColumns(row).pipe(
            Effect.orDie,
            Effect.map((columns): TimelineItem => ({ ...row, ...columns, kind: "hit" })),
          ),
        )
        const pushes = yield* Effect.forEach(pushRows, (row) =>
          decodePushValue(row.value).pipe(
            Effect.orDie,
            Effect.map((value): TimelineItem => ({ ...row, value, kind: "push" })),
          ),
        )
        const merged = [...hits, ...pushes].toSorted((x, y) => compare(tupleOf(x), tupleOf(y)))
        const items = merged.slice(0, PAGE_SIZE)
        const last = items.at(-1)
        const nextCursor =
          merged.length > PAGE_SIZE && last !== undefined
            ? toBase64(encodeCursor(tupleOf(last)))
            : null
        return { items, nextCursor }
      }),
    ),
  )

/** The vendors and events an audit's hits have, for the explorer's filters. */
export const listHitFilters = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ auditId: Schema.String })))
  .handler(({ context, data }) =>
    read(
      Effect.gen(function* () {
        const { organizationId: orgId } = yield* membership(context.session)
        const auditId = yield* auditInOrg(orgId, data.auditId)
        const { db } = yield* Database
        const rows = yield* db
          .selectDistinct({ vendor: hit.vendor, event: hit.event })
          .from(hit)
          .innerJoin(run, eq(run.id, hit.runId))
          .where(and(eq(run.auditId, auditId), eq(run.orgId, orgId), eq(hit.orgId, orgId)))
        return {
          vendors: [...new Set(rows.map((r) => r.vendor))].toSorted(),
          events: [...new Set(rows.map((r) => r.event))].toSorted(),
        }
      }),
    ),
  )

const decodeStoredCapture = Schema.decodeUnknownEffect(Schema.fromJsonString(CaptureResult))

const DetailInput = Schema.Struct({
  auditId: Schema.String,
  runId: Schema.String,
  requestId: Schema.String,
  batchIndex: Schema.Int,
})

/**
 * A hit with the raw request it was decoded from, read from the run's stored `capture.json` by
 * request id. The hit is found by its natural key through the audit, so another organization's
 * audit, run or hit is a 404.
 */
export const getHitDetail = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(DetailInput))
  .handler(({ context, data }) =>
    read(
      Effect.gen(function* () {
        const { organizationId: orgId } = yield* membership(context.session)
        const auditId = yield* auditInOrg(orgId, data.auditId)
        if (!isUuid(data.runId)) return yield* new NotFound({ message: "Not found" })
        const { db } = yield* Database
        const [found] = yield* db
          .select({ hit, captureKey: run.captureKey })
          .from(hit)
          .innerJoin(run, eq(run.id, hit.runId))
          .where(
            and(
              eq(run.id, data.runId),
              eq(run.auditId, auditId),
              eq(run.orgId, orgId),
              eq(hit.orgId, orgId),
              eq(hit.requestId, data.requestId),
              eq(hit.batchIndex, data.batchIndex),
            ),
          )
          .limit(1)
        if (found === undefined || found.captureKey === null)
          return yield* new NotFound({ message: "Not found" })
        const storage = yield* Storage
        const stored = yield* storage.get(found.captureKey).pipe(Effect.orDie)
        if (Option.isNone(stored)) return yield* new NotFound({ message: "Not found" })
        const text = yield* Effect.promise(() => new Response(stored.value.body).text())
        const capture = yield* decodeStoredCapture(text).pipe(Effect.orDie)
        const request = capture.requests.find((r) => r.id === data.requestId)
        if (request === undefined) return yield* new NotFound({ message: "Not found" })
        const columns = yield* decodeHitColumns(found.hit).pipe(Effect.orDie)
        const { hit: row } = found
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
      }),
    ),
  )
