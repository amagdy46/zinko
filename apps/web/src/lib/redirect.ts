/** A same-site path from a `?redirect=` search param, or `/app`. Anything else is ignored. */
export const safeRedirect = (value: unknown): string =>
  typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/app"

export const redirectSearch = (search: Record<string, unknown>): { redirect?: string } =>
  typeof search.redirect === "string" ? { redirect: search.redirect } : {}
