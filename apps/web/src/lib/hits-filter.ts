import { Option, Schema } from "effect"

/** The engine stores request URLs up to this long, and a destination ID is read from one. */
const MAX_VALUE_LENGTH = 8192
const MAX_VALUES = 50

const Value = Schema.String.check(Schema.isMaxLength(MAX_VALUE_LENGTH))

/** One value (the old links) or several. */
export const FilterValues = Schema.Union([
  Value,
  Schema.Array(Value).check(Schema.isMaxLength(MAX_VALUES)),
])

export const FilterText = Value

const decodeText = Schema.decodeUnknownOption(FilterText)

const asText = (value: unknown) => {
  if (typeof value === "number") return String(value)
  return typeof value === "string" && value !== "" ? value : undefined
}

/** A URL parameter as bounded text, or `undefined` when absent, empty or too long. */
export const searchText = (value: unknown) =>
  Option.getOrUndefined(Option.flatMap(Option.fromUndefinedOr(asText(value)), decodeText))

/**
 * A URL parameter as one or several values. These are exact-match filters, so an out-of-bounds
 * value is kept, not dropped: dropping it would widen the filter to everything. The server
 * validates `FilterValues` and refuses it visibly.
 */
export const searchValues = (value: unknown) => {
  const normalized = Array.isArray(value)
    ? value.map(asText).filter((v) => v !== undefined)
    : asText(value)
  return Array.isArray(normalized) && normalized.length === 0 ? undefined : normalized
}
