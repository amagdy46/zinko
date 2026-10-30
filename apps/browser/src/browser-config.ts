/**
 * Files and rules both engines share. `inject/vendors.json` is the one list of vendor hosts and
 * SDK files (the Python engine reads the same file); it is mirrored by
 * `isVendorHost` and `isSdkFile` in `@repo/capture-contract`, since this image cannot import
 * workspace packages. `inject/collection.json` is the decoders' list of collection request
 * shapes, checked by `@zinko/decoders` when it builds, for the same reason. `chromium-args.json` holds the
 * Chromium switches that keep every byte on the egress proxy: no direct DNS, no QUIC, WebRTC
 * limited to proxied UDP, and no background or component-update traffic. Chromium keeps only
 * the last `--disable-features` it is given, so that list merges Playwright's defaults,
 * Scrapling's and ours into one switch.
 */
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { Schema } from "effect"
import { ChromiumArgs, Collection, type EngineJob, Vendors } from "./contract.ts"

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))
const rulesPath = createRequire(import.meta.url).resolve("@duckduckgo/autoconsent/rules/rules.json")

export const files: EngineJob["files"] = {
  shim: here("./inject/datalayer-shim.js"),
  vendors: here("./inject/vendors.json"),
  collection: here("./inject/collection.json"),
  socketGuard: here("./inject/socket-guard.js"),
  chromium: here("./chromium-args.json"),
  autoconsent: `${dirname(rulesPath)}/../dist/autoconsent.playwright.js`,
  rules: rulesPath,
}

const vendors = Schema.decodeSync(Schema.fromJsonString(Vendors))(
  readFileSync(files.vendors, "utf8"),
)
const sdkFiles = new RegExp(vendors.sdkFiles)
const collection = Schema.decodeSync(Schema.fromJsonString(Collection))(
  readFileSync(files.collection, "utf8"),
).endpoints.map(({ methods, path, query }) => ({ methods, path: new RegExp(path), query }))
const chromium = Schema.decodeSync(Schema.fromJsonString(ChromiumArgs))(
  readFileSync(files.chromium, "utf8"),
)

/** A vendor host or any subdomain of one: blocked with `blockVendorRequests`, unless an SDK file. */
export const isVendorHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase().replace(/\.$/, "")
  return vendors.hosts.some((name) => host === name || host.endsWith(`.${name}`))
}

/** A vendor SDK script (gtag.js, fbevents.js, the TikTok pixel), whatever its resource type. */
export const isSdkFile = (url: string): boolean => sdkFiles.test(url)

/**
 * A request in one of the shapes tags send events in, on any host: blocked with
 * `blockVendorRequests` even on the site's own host (a server-side GTM collector forwards what
 * it receives). `isCollectionRequest` in `@zinko/decoders` and `capture.py` read the same list.
 */
export const isCollectionRequest = (method: string, url: string): boolean => {
  if (!URL.canParse(url)) return false
  const { pathname, searchParams } = new URL(url)
  return collection.some(
    (endpoint) =>
      endpoint.methods.includes(method.toUpperCase()) &&
      endpoint.path.test(pathname) &&
      Object.entries(endpoint.query).every(([key, value]) => searchParams.get(key) === value),
  )
}

/**
 * Chromium's own service endpoints (component updates, safe browsing). They survive the switches
 * above, and no page loads from them, so the egress proxy always refuses them.
 */
export const isServiceHost = (hostname: string): boolean =>
  chromium.serviceHosts.includes(hostname.toLowerCase().replace(/\.$/, ""))

/** The switches every capture browser starts with, routed through `proxy`. */
export const chromiumArgs = (proxy: string): string[] => [
  ...chromium.args,
  `--proxy-server=${proxy}`,
  `--disable-features=${chromium.disableFeatures.join(",")}`,
]
