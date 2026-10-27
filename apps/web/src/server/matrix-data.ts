import { CaptureResult } from "@repo/capture-contract"
import { Database } from "@repo/core/Database"
import { hit, run } from "@repo/db"
import { and, asc, eq, inArray, or, type SQL, sql } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"
import { pagePath, runPage, scenarioLabel } from "@/lib/audit-labels"
import {
  ALL_PAGES,
  type ColumnCell,
  type Coverage,
  EVENTS_PER_CELL,
  JOURNEY_PAGE,
  type MatrixColumn,
  type MatrixView,
  type TagRow,
  TAGS_PER_PAGE,
  vendorRank,
} from "@/lib/tag-matrix"

/*
 * The Tag matrix is a read model over `run` and `hit`: every query filters by the organization
 * and by the audit, and the hits of a column are reached through that column's run ids, so
 * nothing outside the audit can be counted.
 */

const SCENARIO_ORDER = ["none", "accept", "reject", "gpc"]
const VIEWPORT_ORDER = ["desktop", "mobile"]

const decodeConsent = Schema.decodeUnknownOption(CaptureResult.fields.consent)

const coverageOf = (status: string): Coverage => {
  if (status === "complete") return "complete"
  return status === "partial" ? "partial" : "none"
}

const byOrder = (order: ReadonlyArray<string>) => (a: string, b: string) =>
  order.indexOf(a) - order.indexOf(b)

const compareText = (a: string, b: string) => {
  if (a === b) return 0
  return a < b ? -1 : 1
}

export interface SliceRun {
  id: string
  columnKey: string
  coverage: Coverage
  consentOutcome: string | null
  page: string
  scenario: string
}

export interface MatrixSlice {
  viewport: string
  viewports: string[]
  scenarios: string[]
  pages: string[]
  journey: string | null
  by: MatrixView["by"]
  page: string
  scenario: string
  columns: MatrixColumn[]
  runs: SliceRun[]
}

/**
 * The runs a view selects, grouped into its columns. `by=scenario` makes one column per scenario
 * over the selected pages (all pages except the journey by default; the journey is its own
 * page); `by=page` makes one column per page, journey included, for one scenario.
 */
export const sliceOf = (orgId: string, auditId: string, view: MatrixView) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const rows = yield* db
      .select({
        id: run.id,
        pageUrl: run.pageUrl,
        scenario: run.scenario,
        viewport: run.viewport,
        journey: run.journey,
        status: run.status,
        consent: run.consent,
      })
      .from(run)
      .where(and(eq(run.auditId, auditId), eq(run.orgId, orgId)))
      .orderBy(asc(run.ordinal))
    const viewports = [...new Set(rows.map((r) => r.viewport))].toSorted(byOrder(VIEWPORT_ORDER))
    const viewport =
      view.viewport !== undefined && viewports.includes(view.viewport)
        ? view.viewport
        : (viewports[0] ?? "desktop")
    const scenarios = [...new Set(rows.map((r) => r.scenario))].toSorted(byOrder(SCENARIO_ORDER))
    const pages = [...new Set(rows.filter((r) => !r.journey).map((r) => pagePath(r.pageUrl)))]
    const journeyRun = rows.find((r) => r.journey)
    const journey = journeyRun === undefined ? null : runPage(journeyRun)

    const inViewport = rows.filter((r) => r.viewport === viewport)
    const wanted = view.page ?? ALL_PAGES
    const knownPage = pages.includes(wanted) || (wanted === JOURNEY_PAGE && journey !== null)
    const page = knownPage ? wanted : ALL_PAGES
    const scenario =
      view.scenario !== undefined && scenarios.includes(view.scenario)
        ? view.scenario
        : (scenarios[0] ?? "none")

    const selected = inViewport.filter((r) => {
      if (view.by === "page") return r.scenario === scenario
      if (page === JOURNEY_PAGE) return r.journey
      if (r.journey) return false
      return page === ALL_PAGES || pagePath(r.pageUrl) === page
    })
    const keyOf = (r: (typeof rows)[number]) => {
      if (view.by === "scenario") return r.scenario
      return r.journey ? JOURNEY_PAGE : r.pageUrl
    }

    const sliceRuns = selected.map((r): SliceRun => {
      const consent = Option.getOrNull(decodeConsent(r.consent))
      return {
        id: r.id,
        columnKey: keyOf(r),
        coverage: coverageOf(r.status),
        consentOutcome: consent?.outcome ?? null,
        page: runPage(r),
        scenario: r.scenario,
      }
    })
    const cmpOf = new Map(
      selected.map((r) => [r.id, Option.getOrNull(decodeConsent(r.consent))?.cmp ?? null]),
    )
    const keys = [...new Set(sliceRuns.map((r) => r.columnKey))]
    if (view.by === "scenario") keys.sort(byOrder(SCENARIO_ORDER))
    const columns = keys.map((key): MatrixColumn => {
      const inColumn = sliceRuns.filter((r) => r.columnKey === key)
      const outcomes: Record<string, number> = {}
      for (const r of inColumn)
        if (r.consentOutcome !== null)
          outcomes[r.consentOutcome] = (outcomes[r.consentOutcome] ?? 0) + 1
      const first = inColumn[0]
      return {
        key,
        label: view.by === "scenario" ? scenarioLabel(key) : (first?.page ?? key),
        runIds: inColumn.map((r) => r.id),
        runs: {
          total: inColumn.length,
          complete: inColumn.filter((r) => r.coverage === "complete").length,
          partial: inColumn.filter((r) => r.coverage === "partial").length,
          none: inColumn.filter((r) => r.coverage === "none").length,
        },
        outcomes,
        cmps: [
          ...new Set(
            inColumn.flatMap((r) => {
              const cmp = cmpOf.get(r.id)
              return cmp === null || cmp === undefined ? [] : [cmp]
            }),
          ),
        ],
      }
    })
    return {
      viewport,
      viewports,
      scenarios,
      pages,
      journey,
      by: view.by,
      page,
      scenario,
      columns,
      runs: sliceRuns,
    } satisfies MatrixSlice
  })

/** SQL for the column a run belongs to; a literal, so select and group by stay the same expression. */
const columnKeySql = (by: MatrixView["by"]) =>
  by === "scenario"
    ? sql<string>`${run.scenario}`
    : sql<string>`case when ${run.journey} then 'journey' else ${run.pageUrl} end`

const tagFilter = (tags: ReadonlyArray<{ vendor: string; destinationId: string }>) => {
  const vendors = [...new Set(tags.map((tag) => tag.vendor))]
  return or(
    ...vendors.map((vendor) =>
      and(
        eq(hit.vendor, vendor),
        inArray(
          hit.destinationId,
          tags.filter((tag) => tag.vendor === vendor).map((tag) => tag.destinationId),
        ),
      ),
    ),
  )
}

const inRuns = (orgId: string, runIds: ReadonlyArray<string>): SQL[] => [
  eq(hit.orgId, orgId),
  eq(run.orgId, orgId),
  inArray(hit.runId, [...runIds]),
]

/** The distinct (vendor, destination) of the slice, in matrix order, with one page of them cut out. */
export const tagsOf = (orgId: string, slice: MatrixSlice, tagPage: number) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const runIds = slice.runs.map((r) => r.id)
    const found =
      runIds.length === 0
        ? []
        : yield* db
            .selectDistinct({ vendor: hit.vendor, destinationId: hit.destinationId })
            .from(hit)
            .innerJoin(run, eq(run.id, hit.runId))
            .where(and(...inRuns(orgId, runIds)))
    const sorted = found.toSorted(
      (a, b) =>
        vendorRank(a.vendor) - vendorRank(b.vendor) ||
        compareText(a.vendor, b.vendor) ||
        compareText(a.destinationId, b.destinationId),
    )
    const perPage = TAGS_PER_PAGE[slice.by]
    const pages = Math.max(1, Math.ceil(sorted.length / perPage))
    const current = Math.min(tagPage, pages)
    const rows = sorted.slice((current - 1) * perPage, current * perPage).map((tag): TagRow => ({
      key: `${tag.vendor}|${tag.destinationId}`,
      vendor: tag.vendor,
      destinationId: tag.destinationId,
    }))
    return { rows, tagTotal: sorted.length, tagPage: current, tagPages: pages }
  })

const cellId = (vendor: string, destinationId: string, column: string) =>
  `${vendor}|${destinationId}|${column}`

/**
 * Exact counts per tag and column in a few grouped queries: events (hits and distinct runs, the
 * top `EVENTS_PER_CELL` kept with the exact event total) and the hits and runs with hits by
 * coverage.
 */
export const cellsOf = (orgId: string, slice: MatrixSlice, rows: ReadonlyArray<TagRow>) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const runIds = slice.runs.map((r) => r.id)
    const where = tagFilter(rows)
    const cells: Record<string, ColumnCell> = {}
    if (runIds.length === 0 || rows.length === 0 || where === undefined) return cells
    const filter = and(...inRuns(orgId, runIds), where)
    const column = columnKeySql(slice.by)
    const totals = yield* db
      .select({
        column,
        vendor: hit.vendor,
        destinationId: hit.destinationId,
        hits: sql<number>`count(*)::int`,
        complete: sql<number>`count(distinct ${hit.runId}) filter (where ${run.status} = 'complete')::int`,
        partial: sql<number>`count(distinct ${hit.runId}) filter (where ${run.status} = 'partial')::int`,
        events: sql<number>`count(distinct ${hit.event})::int`,
      })
      .from(hit)
      .innerJoin(run, eq(run.id, hit.runId))
      .where(filter)
      .groupBy(column, hit.vendor, hit.destinationId)
    const events = yield* db
      .select({
        column,
        vendor: hit.vendor,
        destinationId: hit.destinationId,
        event: hit.event,
        hits: sql<number>`count(*)::int`,
        runs: sql<number>`count(distinct ${hit.runId})::int`,
      })
      .from(hit)
      .innerJoin(run, eq(run.id, hit.runId))
      .where(filter)
      .groupBy(column, hit.vendor, hit.destinationId, hit.event)

    for (const t of totals)
      cells[cellId(t.vendor, t.destinationId, t.column)] = {
        events: [],
        eventTotal: t.events,
        hits: t.hits,
        runsWithHits: { complete: t.complete, partial: t.partial },
      }
    for (const e of events.toSorted(
      (a, b) => b.runs - a.runs || b.hits - a.hits || compareText(a.event, b.event),
    )) {
      const cell = cells[cellId(e.vendor, e.destinationId, e.column)]
      if (cell !== undefined && cell.events.length < EVENTS_PER_CELL)
        cell.events.push({ event: e.event, runs: e.runs, hits: e.hits })
    }
    return cells
  })

/** Every event of one tag in one column, and how many hits each of its runs holds. */
export const cellDetailOf = (
  orgId: string,
  slice: MatrixSlice,
  columnKey: string,
  vendor: string,
  destinationId: string,
) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const inColumn = slice.runs.filter((r) => r.columnKey === columnKey)
    const filter = and(
      ...inRuns(
        orgId,
        inColumn.map((r) => r.id),
      ),
      eq(hit.vendor, vendor),
      eq(hit.destinationId, destinationId),
    )
    const events = yield* db
      .select({
        event: hit.event,
        hits: sql<number>`count(*)::int`,
        runs: sql<number>`count(distinct ${hit.runId})::int`,
      })
      .from(hit)
      .innerJoin(run, eq(run.id, hit.runId))
      .where(filter)
      .groupBy(hit.event)
    const perRun = yield* db
      .select({ runId: hit.runId, hits: sql<number>`count(*)::int` })
      .from(hit)
      .innerJoin(run, eq(run.id, hit.runId))
      .where(filter)
      .groupBy(hit.runId)
    const hitsOf = new Map(perRun.map((r) => [r.runId, r.hits]))
    return {
      events: events.toSorted(
        (a, b) => b.runs - a.runs || b.hits - a.hits || compareText(a.event, b.event),
      ),
      perRun: inColumn.map((r) => ({
        runId: r.id,
        label: slice.by === "scenario" ? r.page : scenarioLabel(r.scenario),
        coverage: r.coverage,
        consentOutcome: r.consentOutcome,
        hits: hitsOf.get(r.id) ?? 0,
      })),
    }
  })
