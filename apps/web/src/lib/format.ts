import { useHydrated } from "@/lib/use-hydrated"

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" })
const dayFormats = new Map<string, Intl.DateTimeFormat>()

/**
 * Dates reach the browser as instants. The server renders in UTC, so a date shows the UTC day until
 * the page hydrates and `useTimeZone` switches to the reader's own zone.
 */
const dayFormat = (timeZone: string | undefined, time: boolean) => {
  const key = `${timeZone ?? ""}|${time}`
  let format = dayFormats.get(key)
  if (format === undefined) {
    format = new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      ...(time ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
      timeZone,
    })
    dayFormats.set(key, format)
  }
  return format
}

/** "28 Oct 2026": unambiguous in every locale, unlike 10/28/2026. The reader's day, not the UTC day. */
export function shortDate(date: Date | string | number, timeZone?: string): string {
  return dayFormat(timeZone, false).format(new Date(date))
}

/**
 * "28 Oct 2026, 02:21": the one date-and-time format. Empty while the zone is still the server's
 * "UTC" (see `useTimeZone`): a time of day in the wrong zone that then jumps is worse than a
 * moment of nothing.
 */
export function shortDateTime(date: Date | string | number, timeZone?: string): string {
  if (timeZone === "UTC") return ""
  return dayFormat(timeZone, true).format(new Date(date))
}

/** "UTC" while rendering on the server and during hydration, then the browser's own zone (undefined). */
export function useTimeZone(): string | undefined {
  return useHydrated() ? undefined : "UTC"
}

/** Use text as the label and title as its full date tooltip. */
export function relativeTime(
  date: Date | string | number,
  timeZone?: string,
): { text: string; title: string } {
  const value = new Date(date)
  const seconds = (value.getTime() - Date.now()) / 1000
  const units = [
    [31536000, "year"],
    [2592000, "month"],
    [604800, "week"],
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
    [1, "second"],
  ] as const
  const [size, unit] = units.find(([threshold]) => Math.abs(seconds) >= threshold) ?? [1, "second"]
  return {
    text: relative.format(Math.round(seconds / size), unit),
    title: shortDateTime(value, timeZone),
  }
}

export function duration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  if (hours > 0) return `${hours}h ${minutes}m ${remainder}s`
  if (minutes > 0) return `${minutes}m ${remainder}s`
  return `${remainder}s`
}

export function count(n: number, noun: string): string {
  let plural = `${noun}s`
  if (/(s|x|ch|sh)$/.test(noun)) plural = `${noun}es`
  else if (/[^aeiou]y$/.test(noun)) plural = `${noun.slice(0, -1)}ies`
  return `${n.toLocaleString("en")} ${n === 1 ? noun : plural}`
}
