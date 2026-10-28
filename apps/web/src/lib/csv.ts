/** A spreadsheet runs a cell as a formula when it starts with one of these. */
const FORMULA_PREFIX = /^[=+\-@\t\r\n]/

/**
 * One text cell: a leading `'` when it could be read as a formula, then RFC 4180 quoting. Numbers
 * are not text and pass through as digits.
 */
export function csvCell(value: string | number | null): string {
  if (value === null) return ""
  if (typeof value === "number") return String(value)
  const safe = FORMULA_PREFIX.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

/** A UTF-8 file with a byte order mark (so spreadsheets read the encoding) and CRLF line ends. */
export const csvFile = (rows: ReadonlyArray<ReadonlyArray<string | number | null>>): string =>
  `﻿${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`
