import { isPrivateHost } from "@repo/capture-contract"

const parse = (url: string): URL | null => (URL.canParse(url) ? new URL(url) : null)

/** The hostname of a URL: lowercase, punycode as `URL` gives it, one trailing dot removed. Null when it does not parse. */
export const canonicalHost = (url: string): string | null => {
  const parsed = parse(url)
  if (parsed === null) return null
  return parsed.hostname.replace(/\.$/, "")
}

/** The host with its port when it is not the scheme's default: `localhost:4400`, `example.com`. */
export const originHost = (origin: string): string => new URL(origin).host

/**
 * A URL belongs to a site when it is http(s), has no credentials, its host is the site's host, one
 * of its declared measured hosts or a subdomain of either, and it uses the same port as the site's
 * origin (another port is another server).
 */
export const isOnSite = (
  url: string,
  site: { host: string; origin: string; measuredHosts?: ReadonlyArray<string> },
): boolean => {
  const parsed = parse(url)
  if (parsed === null) return false
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false
  if (parsed.username !== "" || parsed.password !== "") return false
  const host = canonicalHost(url)
  return (
    host !== null &&
    [site.host, ...(site.measuredHosts ?? [])].some(
      (own) => host === own || host.endsWith(`.${own}`),
    ) &&
    parsed.port === new URL(site.origin).port
  )
}

/** A URL that carries a username or password. */
export const hasCredentials = (url: string): boolean => {
  const parsed = parse(url)
  return parsed !== null && (parsed.username !== "" || parsed.password !== "")
}

/** The URL with any username and password removed, so it can be shown without echoing a secret. */
export const withoutCredentials = (url: string): string => {
  const parsed = parse(url)
  if (parsed === null) return url
  parsed.username = ""
  parsed.password = ""
  return parsed.href
}

/**
 * What someone typed as an address, with a scheme in front when it has none: `https://` for
 * public hosts (`shop.example`), `http://` for localhost and private networks, which rarely serve TLS.
 */
export const withScheme = (text: string): string => {
  const trimmed = text.trim()
  if (trimmed === "" || /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed
  const host = canonicalHost(`http://${trimmed}`)
  return host !== null && isPrivateHost(host) ? `http://${trimmed}` : `https://${trimmed}`
}

/** A page of the site written with the site's own scheme, so an address fixed from https to http carries its saved pages along. */
export const onSiteScheme = (url: string, site: { origin: string }): string => {
  const parsed = parse(url)
  if (parsed === null) return url
  parsed.protocol = new URL(site.origin).protocol
  return parsed.href
}

/** The path and query of an address someone typed, when it names a page below the host; null for the bare host. */
export const startPathOfAddress = (text: string): string | null => {
  const parsed = parse(withScheme(text))
  if (parsed === null || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) return null
  // `//checkout` would read as another host once it is a path on its own, so leading slashes collapse.
  const pathname = parsed.pathname.replace(/^\/+/, "/")
  if (pathname === "/" && parsed.search === "") return null
  return `${pathname}${parsed.search}`
}

/** A key page typed as a path (`/checkout`) is a page of the site; anything else is left for the URL check. */
export const resolveOnSite = (text: string, base: string): string => {
  if (!text.startsWith("/") || text.startsWith("//") || !URL.canParse(text, base)) return text
  return new URL(text, base).href
}
