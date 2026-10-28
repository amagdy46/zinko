import { Database } from "@repo/core/Database"
import { datalayerPush, hit, run } from "@repo/db"
import { createServerFn } from "@tanstack/react-start"
import { CaptureResult } from "@repo/capture-contract"
import { and, asc, count, eq, ilike, inArray, or, type SQL, sql } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"
import {
  auditInOrg,
  decodeHitColumns,
  type HitConsent,
  hitWithRequest,
  type Params,
  readCapture,
  runInAudit,
} from "./audit-data"
import { FilterText, FilterValues } from "@/lib/hits-filter"
import { requireSession } from "./require-session"
import { isUuid, membership, NotFound, read } from "./server-fn"

const PAGE_SIZE = 200

const HIT = 0
const PUSH = 1

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

type TimelineItem =
  | {
      kind: "hit"
      runId: string
      ordinal: number
      requestId: string
      batchIndex: number
      at: number
      vendor: string
      destinationId: string
      event: string
      params: typeof Params.Type
      consent: typeof HitConsent.Type
      blocked: boolean
      status: number | null
      afterConsentAction: boolean
    }
  | {
      kind: "push"
      runId: string
      ordinal: number
      seq: number
      at: number
      value: Schema.Json
    }

/** The row shows only the first few parameters, clipped; the detail loads the rest by hit. */
const PREVIEW_PARAMS = 4
const PREVIEW_CHARS = 120

const previewOf = (params: typeof Params.Type): typeof Params.Type =>
  Object.fromEntries(
    Object.entries(params)
      .slice(0, PREVIEW_PARAMS)
      .map(([name, value]) => [
        name,
        typeof value === "string" ? value.slice(0, PREVIEW_CHARS) : value,
      ]),
  )

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

const many = (value: string | ReadonlyArray<string> | undefined): ReadonlyArray<string> => {
  if (value === undefined) return []
  return typeof value === "string" ? [value] : value
}

const TimelineInput = Schema.Struct({
  auditId: Schema.String,
  runId: Schema.optional(FilterValues),
  vendor: Schema.optional(FilterValues),
  event: Schema.optional(FilterValues),
  destinationId: Schema.optional(FilterValues),
  scenario: Schema.optional(FilterValues),
  timing: Schema.optional(Schema.Literals(["before", "after"])),
  q: Schema.optional(FilterText),
  source: Schema.optional(Schema.Literals(["all", "network", "dataLayer"])),
  cursor: Schema.optional(Schema.String),
})

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`)

const decoded = (text: string) => {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/** Stored parameters are percent-encoded, so a search matches as typed, encoded and decoded. */
const likePatterns = (q: string) =>
  [...new Set([q, encodeURIComponent(q), decoded(q)])].map((text) => `%${escapeLike(text)}%`)

const decodeConsent = Schema.decodeUnknownOption(CaptureResult.fields.consent)

/**
 * One page of an audit's hits and `dataLayer` pushes, interleaved by time. `runId`, `vendor`,
 * `event`, `destinationId` and `scenario` take one value or several. Vendor, event, destination
 * and `timing` apply to hits only; `timing` is `before` or `after` the visitor's choice
 * (`after_consent_action`), so `before` holds every hit of a run with no action. `q` is a case-insensitive match, as typed, percent-encoded and percent-decoded, on a hit's
 * event, destination, ids and parameters and on a push's value; `source` limits the page
 * to hits (`network`) or pushes (`dataLayer`). Besides the page it returns the runs the filters
 * select with their consent action time, and the matched and total counts of each kind, whatever
 * page is loaded. Runs are reached through the audit.
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
        const inAudit: SQL[] = [
          eq(run.auditId, auditId),
          eq(run.role, "target"),
          eq(run.orgId, orgId),
        ]
        const inRun = [...inAudit]
        const runIds = many(data.runId)
        if (runIds.length > 0) {
          // an id that is not a uuid selects nothing
          const valid = runIds.filter(isUuid)
          inRun.push(valid.length === runIds.length ? inArray(run.id, valid) : sql`false`)
        }
        const scenarios = many(data.scenario)
        if (scenarios.length > 0) inRun.push(inArray(run.scenario, [...scenarios]))

        const hitFilters: SQL[] = []
        const pushFilters: SQL[] = []
        const vendors = many(data.vendor)
        if (vendors.length > 0) hitFilters.push(inArray(hit.vendor, [...vendors]))
        const events = many(data.event)
        if (events.length > 0) hitFilters.push(inArray(hit.event, [...events]))
        const destinations = many(data.destinationId)
        if (destinations.length > 0) hitFilters.push(inArray(hit.destinationId, [...destinations]))
        if (data.timing !== undefined)
          hitFilters.push(eq(hit.afterConsentAction, data.timing === "after"))
        const q = data.q?.trim()
        if (q !== undefined && q !== "") {
          const patterns = likePatterns(q)
          const match = or(
            ...patterns.flatMap((pattern) => [
              ilike(hit.event, pattern),
              ilike(hit.destinationId, pattern),
              sql`${hit.ids}::text ilike ${pattern}`,
              sql`${hit.params}::text ilike ${pattern}`,
            ]),
          )
          if (match !== undefined) hitFilters.push(match)
          const pushMatch = or(
            ...patterns.map((pattern) => sql`${datalayerPush.value}::text ilike ${pattern}`),
          )
          if (pushMatch !== undefined) pushFilters.push(pushMatch)
        }

        const hitWhere = [...inRun, eq(hit.orgId, orgId), ...hitFilters]
        const hitMatched = [...hitWhere]
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
                  at: hit.at,
                  vendor: hit.vendor,
                  destinationId: hit.destinationId,
                  event: hit.event,
                  params: hit.params,
                  ids: hit.ids,
                  consent: hit.consent,
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

        const pushWhere = [...inRun, eq(datalayerPush.orgId, orgId), ...pushFilters]
        const pushMatched = [...pushWhere]
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
                  at: datalayerPush.at,
                  value: datalayerPush.value,
                })
                .from(datalayerPush)
                .innerJoin(run, eq(run.id, datalayerPush.runId))
                .where(and(...pushWhere))
                .orderBy(asc(run.ordinal), asc(datalayerPush.at), asc(datalayerPush.seq))
                .limit(PAGE_SIZE + 1)

        const hitsOf = (where: SQL[]) =>
          db
            .select({ n: count() })
            .from(hit)
            .innerJoin(run, eq(run.id, hit.runId))
            .where(and(...where))
        const pushesOf = (where: SQL[]) =>
          db
            .select({ n: count() })
            .from(datalayerPush)
            .innerJoin(run, eq(run.id, datalayerPush.runId))
            .where(and(...where))
        const [[hitsMatched], [hitsTotal], [pushesMatched], [pushesTotal]] = yield* Effect.all([
          hitsOf(hitMatched),
          hitsOf([...inAudit, eq(hit.orgId, orgId)]),
          pushesOf(pushMatched),
          pushesOf([...inAudit, eq(datalayerPush.orgId, orgId)]),
        ])
        const selectedRuns = yield* db
          .select({
            id: run.id,
            ordinal: run.ordinal,
            scenario: run.scenario,
            consent: run.consent,
          })
          .from(run)
          .where(and(...inRun))
          .orderBy(asc(run.ordinal))

        const hits = yield* Effect.forEach(hitRows, (row) =>
          decodeHitColumns(row).pipe(
            Effect.orDie,
            Effect.map((columns): TimelineItem => ({
              kind: "hit",
              runId: row.runId,
              ordinal: row.ordinal,
              requestId: row.requestId,
              batchIndex: row.batchIndex,
              at: row.at,
              vendor: row.vendor,
              destinationId: row.destinationId,
              event: row.event,
              params: previewOf(columns.params),
              consent: columns.consent,
              blocked: row.blocked,
              status: row.status,
              afterConsentAction: row.afterConsentAction,
            })),
          ),
        )
        const pushes = yield* Effect.forEach(pushRows, (row) =>
          decodePushValue(row.value).pipe(
            Effect.orDie,
            Effect.map((value): TimelineItem => ({
              kind: "push",
              runId: row.runId,
              ordinal: row.ordinal,
              seq: row.seq,
              at: row.at,
              value,
            })),
          ),
        )
        const merged = [...hits, ...pushes].toSorted((x, y) => compare(tupleOf(x), tupleOf(y)))
        const items = merged.slice(0, PAGE_SIZE)
        const last = items.at(-1)
        const nextCursor =
          merged.length > PAGE_SIZE && last !== undefined
            ? toBase64(encodeCursor(tupleOf(last)))
            : null
        return {
          items,
          nextCursor,
          runs: selectedRuns.map((selected) => {
            const consent = Option.getOrNull(decodeConsent(selected.consent))
            const acted =
              consent?.outcome === "accepted" ||
              consent?.outcome === "rejected" ||
              consent?.outcome === "not-applied"
            return {
              id: selected.id,
              ordinal: selected.ordinal,
              scenario: selected.scenario,
              consentOutcome: consent?.outcome ?? null,
              consentActionAt: acted ? consent.actionAt : null,
            }
          }),
          counts: {
            hits: { matched: hitsMatched?.n ?? 0, total: hitsTotal?.n ?? 0 },
            pushes: { matched: pushesMatched?.n ?? 0, total: pushesTotal?.n ?? 0 },
          },
        }
      }),
    ),
  )

const countBy = (rows: ReadonlyArray<{ value: string; n: number }>) =>
  rows
    .toSorted((x, y) => compareText(x.value, y.value))
    .map(({ value, n }) => ({ value, count: n }))

/**
 * The vendors, events, destination IDs and scenarios an audit has, each with its number of hits
 * (runs for a scenario), for the explorer's filters.
 */
export const listHitFilters = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ auditId: Schema.String })))
  .handler(({ context, data }) =>
    read(
      Effect.gen(function* () {
        const { organizationId: orgId } = yield* membership(context.session)
        const auditId = yield* auditInOrg(orgId, data.auditId)
        const { db } = yield* Database
        const inAudit = and(
          eq(run.auditId, auditId),
          eq(run.role, "target"),
          eq(run.orgId, orgId),
          eq(hit.orgId, orgId),
        )
        const grouped = (column: typeof hit.vendor) =>
          db
            .select({ value: column, n: count() })
            .from(hit)
            .innerJoin(run, eq(run.id, hit.runId))
            .where(inAudit)
            .groupBy(column)
        const [vendors, events, destinations, scenarios] = yield* Effect.all([
          grouped(hit.vendor),
          grouped(hit.event),
          grouped(hit.destinationId),
          db
            .select({ value: run.scenario, n: count() })
            .from(run)
            .where(and(eq(run.auditId, auditId), eq(run.role, "target"), eq(run.orgId, orgId)))
            .groupBy(run.scenario),
        ])
        return {
          vendors: countBy(vendors),
          events: countBy(events),
          destinations: countBy(destinations),
          scenarios: countBy(scenarios),
        }
      }),
    ),
  )

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
        const found = yield* runInAudit(orgId, auditId, data.runId)
        const capture = yield* readCapture(found.captureKey)
        return yield* hitWithRequest(orgId, found.id, capture, data.requestId, data.batchIndex)
      }),
    ),
  )
