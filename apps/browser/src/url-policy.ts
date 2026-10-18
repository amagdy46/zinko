/**
 * Which URLs the browser may load. This container fetches whatever URL it is given, so without a
 * policy it is a server-side request forgery (SSRF) proxy into every network it can reach.
 *
 * Blocked unless `allowPrivate` is set: non-http(s) schemes, URLs with credentials, `localhost`,
 * `.local`/`.internal` hosts, and IP literals in private, loopback, link-local (cloud metadata
 * at 169.254.169.254), carrier-grade NAT, multicast and reserved ranges, IPv4 and IPv6.
 *
 * Limit: hostnames are checked by name. A public-looking DNS name that resolves to a private
 * address is not caught here, so also restrict egress at the network level if the URLs are untrusted.
 */

export type UrlCheck =
  | { readonly ok: true; readonly url: URL }
  | { readonly ok: false; readonly reason: string }

const blockedSuffixes = [".localhost", ".local", ".internal", ".localdomain", ".home.arpa"]

const ipv4Octets = (host: string): ReadonlyArray<number> | undefined => {
  const parts = host.split(".")
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p))) return undefined
  const octets = parts.map(Number)
  return octets.every((n) => n <= 255) ? octets : undefined
}

const isPrivateIpv4 = ([a = 0, b = 0, c = 0]: ReadonlyArray<number>): boolean =>
  a === 0 ||
  a === 10 ||
  a === 127 ||
  (a === 100 && b >= 64 && b <= 127) ||
  (a === 169 && b === 254) ||
  (a === 172 && b >= 16 && b <= 31) ||
  (a === 192 && b === 0 && c === 0) ||
  (a === 192 && b === 168) ||
  (a === 198 && (b === 18 || b === 19)) ||
  a >= 224

const side = (s: string) => (s === "" ? [] : s.split(":"))

/** Eight 16-bit groups of an IPv6 literal (without brackets), or undefined if it isn't one. */
const ipv6Groups = (host: string): ReadonlyArray<number> | undefined => {
  if (!/^[0-9a-f:.]+$/i.test(host) || !host.includes(":")) return undefined
  let text = host
  const tail = text.slice(text.lastIndexOf(":") + 1)
  if (tail.includes(".")) {
    const v4 = ipv4Octets(tail)
    if (v4 === undefined) return undefined
    const [a = 0, b = 0, c = 0, d = 0] = v4
    text = `${text.slice(0, text.lastIndexOf(":") + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }
  const halves = text.split("::")
  if (halves.length > 2) return undefined
  const head = side(halves[0] ?? "")
  const rest = side(halves[1] ?? "")
  const missing = 8 - head.length - rest.length
  if (halves.length === 1 ? missing !== 0 : missing < 1) return undefined
  const groups = [
    ...head,
    ...Array.from({ length: halves.length === 2 ? missing : 0 }, () => "0"),
    ...rest,
  ]
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return undefined
  return groups.map((g) => Number.parseInt(g, 16))
}

const isPrivateIpv6 = (g: ReadonlyArray<number>): boolean => {
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = g
  const embedded = [g6 >> 8, g6 & 255, g7 >> 8, g7 & 255]
  // ::, ::1 and the deprecated IPv4-compatible ::a.b.c.d
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return true
  // IPv4-mapped ::ffff:a.b.c.d
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff)
    return isPrivateIpv4(embedded)
  // NAT64 64:ff9b::/96 carries an IPv4 address
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0)
    return isPrivateIpv4(embedded)
  // 6to4 2002:AABB:CCDD::/48 carries an IPv4 address
  if (g0 === 0x2002) return isPrivateIpv4([g1 >> 8, g1 & 255, g2 >> 8, g2 & 255])
  return (
    (g0 & 0xfe00) === 0xfc00 || // unique local fc00::/7
    (g0 & 0xffc0) === 0xfe80 || // link-local fe80::/10
    (g0 & 0xff00) === 0xff00 // multicast
  )
}

/** Parses `raw` with `new URL` and applies the policy. `allowPrivate` turns the network checks off. */
export const checkUrl = (raw: string, allowPrivate = false): UrlCheck => {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, reason: "not a valid URL" }
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return { ok: false, reason: "only http and https URLs are allowed" }
  if (url.username !== "" || url.password !== "")
    return { ok: false, reason: "URLs with credentials are not allowed" }
  if (allowPrivate) return { ok: true, url }

  // `new URL` already lowercases, and turns decimal/hex/octal IPv4 forms into dotted quads
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "")
  const blocked = {
    ok: false,
    reason: "this host is not allowed (private or local network)",
  } as const
  if (host === "localhost" || blockedSuffixes.some((suffix) => host.endsWith(suffix)))
    return blocked
  const v4 = ipv4Octets(host)
  if (v4 !== undefined) return isPrivateIpv4(v4) ? blocked : { ok: true, url }
  if (url.hostname.startsWith("[")) {
    const v6 = ipv6Groups(host)
    return v6 === undefined || isPrivateIpv6(v6) ? blocked : { ok: true, url }
  }
  return { ok: true, url }
}
