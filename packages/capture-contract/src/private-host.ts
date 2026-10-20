// Which hostnames name a private, local or reserved network, judged by text alone (no DNS).
// Mirrors the host rules in `apps/browser/src/url-policy.ts`, which cannot import this package;
// change both together.

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

/**
 * Whether a hostname exactly as `URL` gives it (so an IPv6 literal keeps its brackets) is
 * `localhost`, a `.local`-style name, or a private, loopback, link-local, reserved or multicast
 * IP literal.
 */
export const isPrivateHost = (hostname: string): boolean => {
  const host = hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "")
  if (host === "localhost" || blockedSuffixes.some((suffix) => host.endsWith(suffix))) return true
  const v4 = ipv4Octets(host)
  if (v4 !== undefined) return isPrivateIpv4(v4)
  if (hostname.startsWith("[")) {
    const v6 = ipv6Groups(host)
    return v6 === undefined || isPrivateIpv6(v6)
  }
  return false
}
