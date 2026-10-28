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
 * A URL belongs to a site when it is http(s), has no credentials, its host is the site's host or a
 * subdomain of it, and it uses the same port as the site's origin (another port is another server).
 */
export const isOnSite = (url: string, site: { host: string; origin: string }): boolean => {
  const parsed = parse(url)
  if (parsed === null) return false
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false
  if (parsed.username !== "" || parsed.password !== "") return false
  const host = canonicalHost(url)
  return (
    host !== null &&
    (host === site.host || host.endsWith(`.${site.host}`)) &&
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

/** What someone typed as an address, with `https://` in front when it has no scheme (`shop.example`, `localhost:4400`). */
export const withScheme = (text: string): string => {
  const trimmed = text.trim()
  return trimmed === "" || /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}
