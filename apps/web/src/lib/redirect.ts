const base = "http://redirect.invalid"

const hasControl = (text: string) => {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

/** A same-site path from a `?redirect=` search param, or `/app`. Anything else is ignored. */
export const safeRedirect = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    !/^\/(?![/\\])/.test(value) ||
    value.includes("\\") ||
    hasControl(value)
  )
    return "/app"
  const url = new URL(value, base)
  return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : "/app"
}

export const redirectSearch = (search: Record<string, unknown>): { redirect?: string } =>
  typeof search.redirect === "string" ? { redirect: search.redirect } : {}
