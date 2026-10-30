import { useEffect, useReducer } from "react"
import { relativeTime, useTimeZone } from "@/lib/format"

/**
 * "4 minutes ago" for a date. The server and the first client render can straddle a minute, so the
 * text is allowed to differ at hydration (`suppressHydrationWarning` keeps React from replacing the
 * tree) and is recomputed as soon as the page is live and every half minute after. The title is the
 * absolute date in the reader's zone.
 */
export function RelativeTime({
  date,
  className,
}: {
  date: Date | string | number
  className?: string
}) {
  const timeZone = useTimeZone()
  const [, refresh] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 30_000)
    return () => clearInterval(timer)
  }, [])
  const { text, title } = relativeTime(date, timeZone)
  return (
    <time
      dateTime={new Date(date).toISOString()}
      title={title}
      className={className}
      suppressHydrationWarning
    >
      {text}
    </time>
  )
}
