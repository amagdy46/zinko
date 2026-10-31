import { TEST_CLICK_IDS } from "@repo/core/audit"
import { withoutCredentials } from "./site-url"

/** The URL without the test click IDs an audit adds to its start page, so it matches the configured one. */
export const withoutTestClickIds = (url: string) => {
  if (!URL.canParse(url)) return url
  const parsed = new URL(url)
  for (const name of Object.keys(TEST_CLICK_IDS)) parsed.searchParams.delete(name)
  return parsed.href
}

/**
 * The first two configured pages that differ only by the test click IDs or campaign parameters
 * while one of them carries click IDs: an injected run could not say which of them it captured.
 * Null when every page that carries them is told apart. Pages are compared as written.
 */
export function ambiguousClickIdPages(
  pages: ReadonlyArray<string>,
  carries: (index: number) => boolean,
): readonly [string, string] | null {
  for (let i = 0; i < pages.length; i++) {
    for (let j = i + 1; j < pages.length; j++) {
      const a = pages[i] ?? ""
      const b = pages[j] ?? ""
      if ((carries(i) || carries(j)) && withoutTestClickIds(a) === withoutTestClickIds(b))
        return [a, b]
    }
  }
  return null
}

export const clickIdClashMessage = ([a, b]: readonly [string, string]) =>
  `${withoutCredentials(a)} and ${withoutCredentials(b)} differ only by campaign parameters, so click IDs on one of them could not be told from the other. Leave click IDs off these pages or use pages that differ otherwise.`

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
