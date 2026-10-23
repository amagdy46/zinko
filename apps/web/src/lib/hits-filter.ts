import { Option, Schema } from "effect"

const MAX_VALUE_LENGTH = 200
const MAX_VALUES = 50

const Value = Schema.String.check(Schema.isMaxLength(MAX_VALUE_LENGTH))

/** One value (the old links) or several. */
export const FilterValues = Schema.Union([
  Value,
  Schema.Array(Value).check(Schema.isMaxLength(MAX_VALUES)),
])

export const FilterText = Value

const decodeValues = Schema.decodeUnknownOption(FilterValues)
const decodeText = Schema.decodeUnknownOption(FilterText)

const asText = (value: unknown) => {
  if (typeof value === "number") return String(value)
  return typeof value === "string" && value !== "" ? value : undefined
}

/** A URL parameter as bounded text, or `undefined` when absent, empty or too long. */
export const searchText = (value: unknown) =>
  Option.getOrUndefined(Option.flatMap(Option.fromUndefinedOr(asText(value)), decodeText))

/** A URL parameter as one or several bounded values; anything out of bounds is dropped. */
export const searchValues = (value: unknown) => {
  const normalized = Array.isArray(value)
    ? value.map(asText).filter((v) => v !== undefined)
    : asText(value)
  if (Array.isArray(normalized) && normalized.length === 0) return undefined
  return Option.getOrUndefined(Option.flatMap(Option.fromUndefinedOr(normalized), decodeValues))
}
