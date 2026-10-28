import { auditTabName } from "@/lib/audit-labels"

export const pageTitle = (...parts: readonly string[]) => ({
  meta: [{ title: [...parts, "Zinko"].join(" · ") }],
})

/** The slice of a route's `head` context that titles need; annotating it keeps route types from becoming circular. */
export interface TitleContext {
  matches: ReadonlyArray<{ routeId: string; loaderData?: unknown }>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const auditNameOf = (data: unknown): string => {
  if (!isRecord(data) || !isRecord(data.audit) || !isRecord(data.site)) return "Audit"
  const { audit, site } = data
  const pages =
    isRecord(audit.config) && Array.isArray(audit.config.pages) ? audit.config.pages : []
  if (typeof audit.kind !== "string" || typeof site.name !== "string") return "Audit"
  return auditTabName({
    kind: audit.kind,
    siteName: site.name,
    pages: pages.length,
    recheckTitle: typeof audit.recheckTitle === "string" ? audit.recheckTitle : null,
  })
}

/** "<Tab> · Audit of <site> · 12 pages · Zinko"; the audit route's loader says which audit it is. */
export const auditTabTitle = (tab: string, matches: TitleContext["matches"]) =>
  pageTitle(tab, auditNameOf(matches.find((m) => m.routeId === "/app/audits/$auditId")?.loaderData))
