const parse = (url: string): URL | null => (URL.canParse(url) ? new URL(url) : null)

/** The hostname of a URL: lowercase, punycode as `URL` gives it, one trailing dot removed. Null when it does not parse. */
export const canonicalHost = (url: string): string | null => {
  const parsed = parse(url)
  if (parsed === null) return null
  return parsed.hostname.replace(/\.$/, "")
}

/** A URL belongs to a site when it is http(s), has no credentials, and its host is the site's host or a subdomain of it. */
export const isOnSite = (url: string, siteHost: string): boolean => {
  const parsed = parse(url)
  if (parsed === null) return false
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false
  if (parsed.username !== "" || parsed.password !== "") return false
  const host = canonicalHost(url)
  return host !== null && (host === siteHost || host.endsWith(`.${siteHost}`))
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
