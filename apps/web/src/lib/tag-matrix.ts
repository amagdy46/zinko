import { MAX_URL_LENGTH } from "@repo/capture-contract"
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
  page: Schema.optional(Schema.String.check(Schema.isMaxLength(MAX_URL_LENGTH))),
  scenario: Schema.optional(Short),
  mode: Schema.Literals(["events", "consent"]),
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
  mode: decodeField(MatrixView.fields.mode, search.mode) ?? "events",
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
  /** By page: the audited URL, which the label shortens; `clickIds` when it carries test click IDs. */
  pageUrl?: string | undefined
  clickIds: boolean
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

export interface StateCount {
  adStorage: string
  analyticsStorage: string
  hits: number
  runs: number
}

export interface ColumnCell {
  events: { event: string; runs: number; hits: number }[]
  eventTotal: number
  hits: number
  runsWithHits: { complete: number; partial: number }
  consent?: { before: StateCount[]; after: StateCount[] }
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

export const OUTCOME_NOTE: Record<string, string> = {
  accepted: "Choice: accepted",
  rejected: "Choice: rejected",
  none: "No choice made",
  "not-found": "Choice not seen (no banner found)",
  "not-applied": "Choice not seen (did not take effect)",
}

/** Runs whose choice was seen to take effect: the only runs that have an "after the choice". */
export const observedChoices = (column: MatrixColumn) =>
  (column.outcomes.accepted ?? 0) + (column.outcomes.rejected ?? 0)

export interface ConsentColumnCell {
  before: StateCount[]
  after: StateCount[] | "n/a"
  mixed: { before: boolean; after: boolean }
  signal: "google" | "none"
  afterNotApplicable: number
}

/**
 * The consent states a tag's hits carried across a column's runs. Meta and TikTok hits carry no
 * consent signal. The after bucket is "n/a" when no run of the column had its choice observed;
 * nothing is inferred from the action finishing.
 */
export const consentColumnCell = (
  cell: ColumnCell | undefined,
  column: MatrixColumn,
  vendor: string,
): ConsentColumnCell => {
  const before = cell?.consent?.before ?? []
  const after = cell?.consent?.after ?? []
  const observed = observedChoices(column)
  const known = Object.values(column.outcomes).reduce((sum, n) => sum + n, 0)
  return {
    before,
    after: observed === 0 ? "n/a" : after,
    mixed: { before: before.length > 1, after: after.length > 1 },
    signal: vendor === "ga4" || vendor === "google-ads" ? "google" : "none",
    afterNotApplicable: known - observed,
  }
}

/** The two consent fields named, so "denied / denied" is never a guess which is which. */
export const consentWords = (adStorage: string, analyticsStorage: string) =>
  `Ads ${adStorage} · Analytics ${analyticsStorage}`

export const stateLabel = (state: StateCount) =>
  consentWords(state.adStorage, state.analyticsStorage)

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
