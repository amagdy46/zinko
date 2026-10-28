import { pageLabels } from "@/lib/audit-labels"

const CLICK_IDS = ["gclid", "gbraid", "wbraid", "dclid", "fbclid", "ttclid", "msclkid"]

/** Whether the audit added test click IDs to this page URL. */
export const hasClickIds = (pageUrl: string) => {
  const { searchParams } = new URL(pageUrl)
  return CLICK_IDS.some((name) => searchParams.has(name))
}

const withoutQuery = (pageUrl: string) => {
  const { pathname, hash } = new URL(pageUrl)
  return pathname + hash
}

/**
 * The path of each page URL without its query, which is long when the audit adds click IDs; the
 * full URL belongs in a title. Pages that only a query or a host tells apart keep `pageLabels`.
 */
export const pathLabels = (pageUrls: ReadonlyArray<string>) => {
  const urls = [...new Set(pageUrls)]
  const full = pageLabels(urls)
  return new Map(
    urls.map((url) => {
      const label = withoutQuery(url)
      const shared = urls.filter((other) => withoutQuery(other) === label).length > 1
      return [url, shared ? (full.get(url) ?? url) : label]
    }),
  )
}

/** A run's page for display: the path, "Journey from" for the journey run, and the host a cross-host run follows a link to. */
export const runPageLabel = (run: {
  pageUrl: string
  journey: boolean
  followHost?: string | null
}) => {
  if (run.followHost !== undefined && run.followHost !== null)
    return `Journey from ${withoutQuery(run.pageUrl)}, then ${run.followHost}`
  return run.journey ? `Journey from ${withoutQuery(run.pageUrl)}` : withoutQuery(run.pageUrl)
}
