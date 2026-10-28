import type { Cookie, CookieSnapshot } from "@repo/capture-contract"
import type { EvidenceRef, RunInput } from "./types.js"

const FAMILIES: readonly (readonly [RegExp, string])[] = [
  [/^_ga$/, "Google Analytics client cookie"],
  [/^_ga_.+$/, "GA4 session cookie"],
  [/^_gid$/, "Google Analytics daily cookie"],
  [/^_gcl_.+$/, "Google Ads click cookie"],
  [/^_fbp$/, "Meta browser cookie"],
  [/^_fbc$/, "Meta click cookie"],
  [/^(_ttp|_tt_.+|ttcsid.*)$/, "TikTok cookie"],
  [/^(IDE|test_cookie)$/, "Google ad cookie"],
]

/** Every label `cookieFamily` can return. */
export const COOKIE_FAMILY_LABELS: readonly string[] = FAMILIES.map(([, label]) => label)

/**
 * The fixed label of the ad or analytics cookie family a name belongs to, or `null` for any other
 * cookie. The patterns accept arbitrary suffixes (`_gcl_<anything>`), so the label is what to show,
 * never the name.
 */
export function cookieFamily(name: string): string | null {
  return FAMILIES.find(([pattern]) => pattern.test(name))?.[1] ?? null
}

/** Google Analytics, Google Ads, Meta and TikTok cookies; consent banners' own cookies are not. */
export function isAdOrAnalyticsCookie(name: string): boolean {
  return cookieFamily(name) !== null
}

/** RFC 6265 §5.1.4: the cookie's path is the request path or a `/`-bounded prefix of it. */
function pathMatches(cookiePath: string, requestPath: string): boolean {
  if (requestPath === cookiePath) return true
  if (!requestPath.startsWith(cookiePath)) return false
  return cookiePath.endsWith("/") || requestPath[cookiePath.length] === "/"
}

/**
 * Whether a script on the page at `url` sees the cookie in `document.cookie`. Snapshots hold every
 * cookie of the browser context, so a cookie from another host or path is not this page's. The
 * contract keeps no host-only flag; it uses Playwright's convention: a domain cookie's domain
 * starts with a dot and covers subdomains, a host-only cookie's matches its host exactly.
 */
export function readableByScriptOn(cookie: Cookie, url: string): boolean {
  if (cookie.httpOnly || !URL.canParse(url)) return false
  const { hostname, pathname } = new URL(url)
  const hostMatches = cookie.domain.startsWith(".")
    ? hostname === cookie.domain.slice(1) || hostname.endsWith(cookie.domain)
    : hostname === cookie.domain
  return hostMatches && pathMatches(cookie.path, pathname)
}

export function snapshotsLabelled(
  input: RunInput,
  ...labels: readonly CookieSnapshot["label"][]
): readonly CookieSnapshot[] {
  return input.capture.cookies.filter((snapshot) => labels.includes(snapshot.label))
}

export function cookieRef(snapshot: CookieSnapshot, cookie: Cookie): EvidenceRef {
  return {
    kind: "cookie",
    label: snapshot.label,
    documentId: snapshot.documentId,
    name: cookie.name,
    domain: cookie.domain,
    path: cookie.path,
  }
}
