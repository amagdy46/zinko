/**
 * Files and rules both engines share. `inject/vendors.json` is the one list of vendor hosts and
 * SDK files (the Python engine reads the same file); it mirrors the rule in
 * `packages/fixtures/inspect.mjs`, since this image cannot import workspace packages. `chromium-args.json` holds the
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
import { ChromiumArgs, type EngineJob, Vendors } from "./contract.ts"

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))
const rulesPath = createRequire(import.meta.url).resolve("@duckduckgo/autoconsent/rules/rules.json")

export const files: EngineJob["files"] = {
  shim: here("./inject/datalayer-shim.js"),
  vendors: here("./inject/vendors.json"),
  chromium: here("./chromium-args.json"),
  autoconsent: `${dirname(rulesPath)}/../dist/autoconsent.playwright.js`,
  rules: rulesPath,
}

const vendors = Schema.decodeSync(Schema.fromJsonString(Vendors))(
  readFileSync(files.vendors, "utf8"),
)
const sdkFiles = new RegExp(vendors.sdkFiles)
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
