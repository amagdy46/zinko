import { Option, Schema } from "effect"

export const TAGS_PER_PAGE = { scenario: 25, page: 10 } as const
export const EVENTS_PER_CELL = 6

export const JOURNEY_PAGE = "journey"
export const ALL_PAGES = "all"

const Short = Schema.String.check(Schema.isMaxLength(20))

/** What the Tag matrix tab keeps in the URL; the same fields travel to the server functions. */
export const MatrixView = Schema.Struct({
  viewport: Schema.optional(Short),
  by: Schema.Literals(["scenario", "page"]),
  page: Schema.optional(Schema.String.check(Schema.isMaxLength(2000))),
  scenario: Schema.optional(Short),
  tagPage: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100_000 })),
})
export type MatrixView = typeof MatrixView.Type

const decodeField = <S extends Schema.Decoder<unknown>>(schema: S, value: unknown) =>
  Option.getOrUndefined(Schema.decodeUnknownOption(schema)(value))

/** The URL's search parameters as a view; anything that does not validate falls back to the default. */
export const matrixView = (search: Record<string, unknown>): MatrixView => ({
  viewport: decodeField(MatrixView.fields.viewport, search.viewport),
  by: decodeField(MatrixView.fields.by, search.by) ?? "scenario",
  page: decodeField(MatrixView.fields.page, search.page),
  scenario: decodeField(MatrixView.fields.scenario, search.scenario),
  tagPage: decodeField(MatrixView.fields.tagPage, Number(search.tagPage ?? 1)) ?? 1,
})

export type Coverage = "complete" | "partial" | "none"

export interface RunCounts {
  total: number
  complete: number
  partial: number
  none: number
}

export interface MatrixColumn {
  key: string
  label: string
  runIds: string[]
  runs: RunCounts
  /** Consent outcomes of the column's runs; a run with no stored consent is not counted. */
  outcomes: Record<string, number>
  cmps: string[]
}

export interface TagRow {
  key: string
  vendor: string
  destinationId: string
}

export interface ColumnCell {
  events: { event: string; runs: number; hits: number }[]
  eventTotal: number
  hits: number
  runsWithHits: { complete: number; partial: number }
}

export const cellKey = (row: TagRow, column: MatrixColumn) => `${row.key}|${column.key}`

export interface Incomplete {
  partial: number
  none: number
}

export type CellState =
  | { state: "fired"; events: ColumnCell["events"]; incomplete: Incomplete | null }
  | { state: "none-seen"; incomplete: Incomplete | null }
  | { state: "not-captured" }

/**
 * A zero is only "none seen" when every run of the column was captured whole. A column that
 * mixes complete runs with partial or uncaptured ones keeps the gap in the state, and a column
 * where nothing was captured is "not captured", whatever the tag.
 */
export const cellState = (cell: ColumnCell | undefined, column: MatrixColumn): CellState => {
  const { total, partial, none } = column.runs
  if (none === total) return { state: "not-captured" }
  const incomplete = partial + none > 0 ? { partial, none } : null
  if (cell === undefined || cell.hits === 0) return { state: "none-seen", incomplete }
  return { state: "fired", events: cell.events, incomplete }
}

const gaps = ({ partial, none }: Incomplete) =>
  [partial > 0 && `${partial} partial`, none > 0 && `${none} not captured`]
    .filter((part) => part !== false)
    .join(", ")

/** Why a cell is not the whole story, in words; null when every run was captured whole. */
export const coverageNote = (
  state: CellState,
  column: MatrixColumn,
  cell: ColumnCell | undefined,
): string | null => {
  if (state.state === "not-captured") return null
  if (state.incomplete === null) return null
  if (state.state === "none-seen")
    return `in ${column.runs.complete} complete ${column.runs.complete === 1 ? "run" : "runs"}; ${gaps(state.incomplete)}`
  const seen = (cell?.runsWithHits.complete ?? 0) + (cell?.runsWithHits.partial ?? 0)
  return `from ${seen} of ${column.runs.total} runs; ${gaps(state.incomplete)}`
}

const VENDOR_NAMES: Record<string, string> = {
  ga4: "Google Analytics 4",
  "google-ads": "Google Ads",
  meta: "Meta",
  tiktok: "TikTok",
}

export const vendorName = (vendor: string) => VENDOR_NAMES[vendor] ?? vendor

/** ga4, google-ads, meta, tiktok, then anything else. */
export const vendorRank = (vendor: string) => {
  const rank = Object.keys(VENDOR_NAMES).indexOf(vendor)
  return rank === -1 ? Object.keys(VENDOR_NAMES).length : rank
}
