/**
 * The HTTP proxy every capture browser is launched behind. Page routes cannot see redirect hops
 * or the browser's own traffic, so the rules are applied here, once per connection: `CONNECT
 * host:port` for https and websockets, absolute-form requests for plain http. The proxy resolves
 * the name, refuses private addresses unless `allowPrivate` is set, and connects to the address
 * it checked. With `blockVendors` it refuses every vendor host: a tunnel does not show the path,
 * so SDK files cannot be told apart from collection endpoints on the same host. The engines load
 * SDK files through `GET /sdk?url=<url>` on this proxy instead, which fetches only SDK file URLs.
 * It also counts response bytes and cuts every connection once the capture's total passes
 * `maxResponseBytes`.
 */
import { request as httpsRequest } from "node:https"
import { connect, createServer, isIPv6, type LookupFunction, type Socket } from "node:net"
import { isSdkFile, isServiceHost, isVendorHost } from "./browser-config.ts"
import { checkUrl, resolveHost } from "./url-policy.ts"

/** A connection the policy refused. `url` is known for plain http; https only shows its origin. */
export type Refusal = {
  readonly at: number
  readonly origin: string
  readonly url: string | null
  readonly reason: string
}

export type EgressProxy = {
  readonly url: string
  readonly refusals: ReadonlyArray<Refusal>
  /** `host:port` of every upstream the proxy connected to. */
  readonly contacted: ReadonlySet<string>
  readonly limitHit: () => boolean
  readonly close: () => void
}

const MAX_HEAD_BYTES = 64 * 1024
const CONNECT_TIMEOUT_MS = 10_000
const hopByHop = new Set(["connection", "proxy-connection", "keep-alive", "proxy-authorization"])
/** Request headers passed on when fetching an SDK file for the browser. */
const sdkHeaders = new Set(["user-agent", "accept", "accept-language", "referer", "cookie"])
/** Response headers passed back with an SDK file; the rest (CSP, reporting) do not apply to it. */
const sdkResponseHeaders = new Set([
  "content-type",
  "cache-control",
  "set-cookie",
  "timing-allow-origin",
  "cross-origin-resource-policy",
  "access-control-allow-origin",
  "access-control-allow-credentials",
])

const headerName = (line: string) => line.slice(0, line.indexOf(":")).trim().toLowerCase()
const headerValue = (line: string) => line.slice(line.indexOf(":") + 1).trim()
const status = (code: number, text: string) =>
  `HTTP/1.1 ${code} ${text}\r\ncontent-length: 0\r\nconnection: close\r\n\r\n`

type Head = { readonly method: string; readonly target: string; readonly lines: string[] }

/** Reads the request head; whatever followed it is unshifted back onto the socket. */
const readHead = (socket: Socket): Promise<Head | undefined> =>
  new Promise((resolve) => {
    let buffered = Buffer.alloc(0)
    const onData = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk])
      const end = buffered.indexOf("\r\n\r\n")
      if (end === -1) {
        if (buffered.length > MAX_HEAD_BYTES) finish(undefined)
        return
      }
      const rest = buffered.subarray(end + 4)
      const [requestLine = "", ...lines] = buffered
        .subarray(0, end)
        .toString("latin1")
        .split("\r\n")
      const [method = "", target = ""] = requestLine.split(" ")
      finish({ method, target, lines })
      if (rest.length > 0) socket.unshift(rest)
    }
    const finish = (head: Head | undefined) => {
      socket.off("data", onData)
      socket.off("end", onEnd)
      socket.pause()
      resolve(head)
    }
    const onEnd = () => finish(undefined)
    socket.on("data", onData)
    socket.once("end", onEnd)
  })

export const startEgressProxy = (options: {
  readonly allowPrivate: boolean
  readonly blockVendors: boolean
  readonly maxResponseBytes: number
  readonly now: () => number
}): Promise<EgressProxy> => {
  const refusals: Refusal[] = []
  const contacted = new Set<string>()
  const sockets = new Set<Socket>()
  let responseBytes = 0
  let limitHit = false

  const track = (socket: Socket) => {
    sockets.add(socket)
    socket.once("close", () => sockets.delete(socket))
    socket.on("error", () => socket.destroy())
  }

  const countResponse = (chunk: Buffer) => {
    responseBytes += chunk.length
    if (responseBytes <= options.maxResponseBytes || limitHit) return
    limitHit = true
    for (const socket of sockets) socket.destroy()
  }

  const connectTo = (address: string, port: number): Promise<Socket | undefined> =>
    new Promise((resolve) => {
      const upstream = connect({ host: address, port })
      track(upstream)
      upstream.setTimeout(CONNECT_TIMEOUT_MS, () => {
        upstream.destroy()
        resolve(undefined)
      })
      upstream.once("connect", () => {
        upstream.setTimeout(0)
        resolve(upstream)
      })
      upstream.once("error", () => resolve(undefined))
    })

  /** Tries each checked address in turn, as a browser would (localhost is often ::1, then 127.0.0.1). */
  const open = (addresses: ReadonlyArray<string>, port: number) =>
    addresses.reduce<Promise<Socket | undefined>>(
      (previous, address) => previous.then((socket) => socket ?? connectTo(address, port)),
      Promise.resolve(undefined),
    )

  const splice = (client: Socket, upstream: Socket) => {
    upstream.on("data", countResponse)
    upstream.pipe(client)
    client.pipe(upstream)
    client.once("close", () => upstream.destroy())
    upstream.once("close", () => client.destroy())
    client.resume()
  }

  /**
   * `GET /sdk?url=`: fetches one SDK file over https from the address the policy checked. With
   * ALLOW_PRIVATE_NETWORKS=true a page can reach this endpoint through the proxy itself
   * (127.0.0.1 is allowed then), which only lets it fetch SDK files; the default refuses it.
   */
  const fetchSdk = async (client: Socket, head: Head) => {
    const target = new URL(head.target, "http://proxy").searchParams.get("url") ?? ""
    const checked = checkUrl(target, options.allowPrivate)
    // Match the URL that will be fetched, and refuse any that only normalizes into one (`..`, `%2e`).
    if (!checked.ok || checked.url.href !== target || !isSdkFile(checked.url.href)) {
      client.end(status(403, "Forbidden"))
      return
    }
    const url = checked.url
    const resolved = await resolveHost(url.hostname, options.allowPrivate)
    const [address] = resolved.ok ? resolved.addresses : []
    if (address === undefined) {
      client.end(status(403, "Forbidden"))
      return
    }
    const family = isIPv6(address) ? 6 : 4
    const lookup: LookupFunction = (_hostname, lookupOptions, callback) => {
      if (lookupOptions.all) callback(null, [{ address, family }])
      else callback(null, address, family)
    }
    const headers: Record<string, string> = { "accept-encoding": "identity" }
    for (const line of head.lines)
      if (sdkHeaders.has(headerName(line))) headers[headerName(line)] = headerValue(line)
    contacted.add(url.host)
    const upstream = httpsRequest(url, { headers, lookup, timeout: CONNECT_TIMEOUT_MS })
    upstream.on("response", (response) => {
      const lines: string[] = []
      for (let index = 0; index + 1 < response.rawHeaders.length; index += 2) {
        const [name = "", value = ""] = response.rawHeaders.slice(index, index + 2)
        if (sdkResponseHeaders.has(name.toLowerCase()))
          lines.push(`${name.toLowerCase()}: ${value}`)
      }
      client.write(
        [`HTTP/1.1 ${response.statusCode ?? 502} SDK`, ...lines, "connection: close", "", ""].join(
          "\r\n",
        ),
      )
      response.on("data", countResponse)
      response.pipe(client)
    })
    upstream.on("timeout", () => upstream.destroy())
    upstream.on("error", () => client.end(status(502, "Bad Gateway")))
    upstream.end()
  }

  const handle = async (client: Socket) => {
    track(client)
    const head = await readHead(client)
    if (head === undefined || limitHit) return client.destroy()
    if (head.method === "GET" && head.target.startsWith("/sdk?")) return fetchSdk(client, head)
    const tunnel = head.method === "CONNECT"
    const raw = tunnel ? `https://${head.target}/` : head.target
    const refuse = (reason: string) => {
      const origin = URL.canParse(raw) ? new URL(raw).origin : head.target
      refusals.push({ at: options.now(), origin, url: tunnel ? null : raw, reason })
      if (tunnel) client.end(status(403, "Forbidden"))
      else client.destroy()
    }
    const checked = checkUrl(raw, options.allowPrivate)
    if (!checked.ok) return refuse(checked.reason)
    const url = checked.url
    if (isServiceHost(url.hostname)) return refuse("Chromium service host")
    if (options.blockVendors && isVendorHost(url.hostname))
      return refuse("vendor host, blocked by blockVendorRequests")
    const resolved = await resolveHost(url.hostname, options.allowPrivate)
    if (!resolved.ok) return refuse(resolved.reason)
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80))
    const upstream = await open(resolved.addresses, port)
    if (upstream === undefined) {
      if (tunnel) client.end(status(502, "Bad Gateway"))
      else client.destroy()
      return
    }
    contacted.add(url.host)
    if (tunnel) {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n")
      return splice(client, upstream)
    }
    // One request per connection: the browser cannot reuse it for a host we have not checked.
    const headers = head.lines.filter((line) => !hopByHop.has(headerName(line)))
    const requestLine = `${head.method} ${url.pathname}${url.search} HTTP/1.1`
    upstream.write([requestLine, ...headers, "connection: close", "", ""].join("\r\n"))
    splice(client, upstream)
  }

  const server = createServer((client) => {
    handle(client).catch(() => client.destroy())
  })

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address !== null ? address.port : 0
      resolve({
        url: `http://127.0.0.1:${port}`,
        refusals,
        contacted,
        limitHit: () => limitHit,
        close: () => {
          server.close()
          for (const socket of sockets) socket.destroy()
        },
      })
    })
  })
}
