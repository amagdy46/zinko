const base = "http://redirect.invalid"

/** A same-site path from a `?redirect=` search param, or `/app`. Anything else is ignored. */
export const safeRedirect = (value: unknown): string => {
  if (typeof value !== "string" || !/^\/(?![/\\])[^\\\u0000-\u001f\u007f]*$/.test(value))
    return "/app"
  const url = new URL(value, base)
  return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : "/app"
}

export const redirectSearch = (search: Record<string, unknown>): { redirect?: string } =>
  typeof search.redirect === "string" ? { redirect: search.redirect } : {}
