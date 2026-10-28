export const pageTitle = (...parts: readonly string[]) => ({
  meta: [{ title: [...parts, "Zinko"].join(" · ") }],
})

/** The slice of a route's `head` context that titles need; annotating it keeps route types from becoming circular. */
export interface TitleContext {
  matches: ReadonlyArray<{ routeId: string; loaderData?: unknown }>
}

const siteNameOf = (data: unknown): string | undefined => {
  if (typeof data !== "object" || data === null || !("site" in data)) return undefined
  const { site } = data
  if (typeof site !== "object" || site === null || !("name" in site)) return undefined
  return typeof site.name === "string" ? site.name : undefined
}

/** "<Tab> · Audit of <site> · Zinko"; the site name comes from the audit route's loader. */
export const auditTabTitle = (tab: string, matches: TitleContext["matches"]) => {
  const name = siteNameOf(matches.find((m) => m.routeId === "/app/audits/$auditId")?.loaderData)
  return pageTitle(tab, name === undefined ? "Audit" : `Audit of ${name}`)
}
