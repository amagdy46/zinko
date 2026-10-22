const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" })
const fullDate = new Intl.DateTimeFormat("en", {
  dateStyle: "full",
  timeStyle: "long",
  timeZone: "UTC",
})

/** Use text as the label and title as its full date tooltip. */
export function relativeTime(date: Date | string | number): { text: string; title: string } {
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
  return { text: relative.format(Math.round(seconds / size), unit), title: fullDate.format(value) }
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
