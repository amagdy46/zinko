import { TEST_CLICK_IDS } from "@repo/core/audit"

/** The URL without the test click IDs an audit adds to its start page, so it matches the configured one. */
export const withoutTestClickIds = (url: string) => {
  if (!URL.canParse(url)) return url
  const parsed = new URL(url)
  for (const name of Object.keys(TEST_CLICK_IDS)) parsed.searchParams.delete(name)
  return parsed.href
}

/**
 * Where a run's page URL sits in the audit's configured pages: the exact URL first, then the same
 * URL minus the test click IDs. Pages that only a query tells apart stay apart. -1 when unknown.
 */
export function pageIndexOf(pages: ReadonlyArray<string>, pageUrl: string): number {
  const exact = pages.indexOf(pageUrl)
  if (exact !== -1) return exact
  const stripped = withoutTestClickIds(pageUrl)
  return pages.findIndex((page) => withoutTestClickIds(page) === stripped)
}
