import { Option, Schema } from "effect"
import type { CellKey } from "@/lib/compare"

const StoredCell = Schema.Struct({
  page: Schema.String,
  scenario: Schema.String,
  viewport: Schema.String,
  itinerary: Schema.NullOr(Schema.Array(Schema.String)),
  injected: Schema.Boolean,
})
const decode = Schema.decodeUnknownOption(Schema.Array(StoredCell))

/** The `CellKey`s of a stored `narrow_cells` or `narrow_companions` value; none when it does not decode. */
export const storedCells = (value: unknown): CellKey[] =>
  Option.getOrElse(decode(value), () => []).map((t): CellKey => ({
    page: t.page,
    scenario: t.scenario,
    viewport: t.viewport,
    itinerary: t.itinerary === null ? null : [...t.itinerary],
    injected: t.injected,
  }))
