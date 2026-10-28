/**
 * Which URLs the browser may load. This container fetches whatever URL it is given, so without a
 * policy it is a server-side request forgery (SSRF) proxy into every network it can reach.
 *
 * Blocked unless `allowPrivate` is set: non-http(s) schemes, URLs with credentials, `localhost`,
 * `.local`/`.internal` hosts, and IP literals in private, loopback, link-local (cloud metadata
 * at 169.254.169.254), carrier-grade NAT, multicast and reserved ranges, IPv4 and IPv6.
 *
 * `checkUrl` judges a URL by its text; `resolveHost` also resolves the name and refuses it if any
 * address is private. The egress proxy (`egress-proxy.ts`) runs both on every connection the
 * browser opens, redirects included, and connects to the address it checked, so Chromium never
 * looks the name up itself and a DNS answer cannot change between the check and the connection.
 * Anything that does not go through the proxy (none is expected; WebRTC is limited to proxied
 * UDP) is only stopped by the container's egress limits, so keep those as well.
 */
// The host rules below are mirrored by `isPrivateHost` in packages/capture-contract/src/private-host.ts (the web app uses that copy); change both together.
import type { LookupAddress } from "node:dns"
import { lookup } from "node:dns/promises"

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

/** Whether an IP address, as `dns.lookup` returns it, is private, local or reserved. */
export const isPrivateAddress = (address: string): boolean => {
  const v4 = ipv4Octets(address)
  if (v4 !== undefined) return isPrivateIpv4(v4)
  const v6 = ipv6Groups(address.replace(/%.*$/, ""))
  return v6 === undefined || isPrivateIpv6(v6)
}

export type HostCheck =
  | { readonly ok: true; readonly addresses: ReadonlyArray<string> }
  | { readonly ok: false; readonly reason: string }

/**
 * Resolves `host` and refuses it if any address is private, unless `allowPrivate` is set. With
 * `allowPrivate`, `*.localhost` names are loopback (RFC 6761) whatever the system resolver says,
 * so the fixtures' virtual hosts work on machines that only resolve `localhost` itself.
 */
export const resolveHost = async (host: string, allowPrivate: boolean): Promise<HostCheck> => {
  const name = host.replace(/^\[|\]$/g, "")
  if (allowPrivate && name.replace(/\.$/, "").endsWith(".localhost"))
    return { ok: true, addresses: ["127.0.0.1"] }
  const answers: ReadonlyArray<LookupAddress> = await lookup(name, {
    all: true,
    verbatim: true,
  }).catch(() => [])
  const [first] = answers
  if (first === undefined) return { ok: false, reason: `could not resolve ${name}` }
  if (!allowPrivate && answers.some((answer) => isPrivateAddress(answer.address)))
    return { ok: false, reason: `${name} resolves to a private or local address` }
  return { ok: true, addresses: answers.map((answer) => answer.address) }
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
