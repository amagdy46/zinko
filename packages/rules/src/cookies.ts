import type { Cookie, CookieSnapshot } from "@repo/capture-contract"
import type { EvidenceRef, RunInput } from "./types.js"

const AD_OR_ANALYTICS = /^(_ga|_ga_.+|_gid|_gcl_.+|_fbp|_fbc|_ttp|_tt_.+|ttcsid.*|IDE|test_cookie)$/

/** Google Analytics, Google Ads, Meta and TikTok cookies; consent banners' own cookies are not. */
export function isAdOrAnalyticsCookie(name: string): boolean {
  return AD_OR_ANALYTICS.test(name)
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
