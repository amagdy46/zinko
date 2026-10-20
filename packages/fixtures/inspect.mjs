// Usage: pnpm --filter @repo/fixtures inspect <site>[/page] [accept|reject]
// Opens a fixture site on a private server, answers vendor collection requests with 204 so
// nothing reaches the vendors, clicks the banner and prints every vendor request with its time.
import { chromium } from "playwright"
import { sites } from "./sites.mjs"
import { startServer } from "./server.mjs"

// The same rule as the capture engine's blockVendorRequests (plan, Task 4).
const collectionEndpoints = [
  { vendor: "ga4", test: /^https:\/\/([^/]+\.)?google-analytics\.com\/g\/collect/ },
  { vendor: "ga4", test: /^https:\/\/([^/]+\.)?googletagmanager\.com\/g\/collect/ },
  { vendor: "google-ads", test: /^https:\/\/www\.googleadservices\.com\/pagead\/conversion\// },
  { vendor: "google-ads", test: /^https:\/\/www\.google\.com\/pagead\/1p-conversion\// },
  {
    vendor: "google-ads",
    test: /^https:\/\/googleads\.g\.doubleclick\.net\/pagead\/viewthroughconversion\//,
  },
  { vendor: "meta", test: /^https:\/\/www\.facebook\.com\/tr/ },
  { vendor: "tiktok", test: /^https:\/\/analytics\.tiktok\.com\/api\/v2\/pixel/ },
]
const sdkFiles =
  /^https:\/\/(www\.googletagmanager\.com\/(gtag\/js|gtm\.js)|connect\.facebook\.net\/(\w+\/fbevents\.js|signals\/config\/)|analytics\.tiktok\.com\/i18n\/pixel\/)/
const vendorHosts =
  /(^|\.)(google-analytics|googletagmanager|doubleclick|googleadservices|googlesyndication|facebook|facebook\.net|instagram|conversionsapigateway|tiktok)\.(com|net)$|(^|\.)tiktokw\.us$|^(www\.)?google\.com$/

const [target, action = "none"] = process.argv.slice(2)
const siteName = target?.split("/")[0] ?? ""
if (!Object.hasOwn(sites, siteName) || !["none", "accept", "reject"].includes(action)) {
  console.error(
    `usage: inspect <site>[/page] [accept|reject]\nsites: ${Object.keys(sites).join(", ")}`,
  )
  process.exit(1)
}

const server = await startServer(0)
const origin = `http://localhost:${server.address().port}`
const path = target.includes("/") ? target : `${target}/`
const t0 = Date.now()
const stamp = () => `${String(Date.now() - t0).padStart(5)}ms`
const out = (line) => process.stdout.write(`${line}\n`)

function describe(vendor, request) {
  const url = new URL(request.url())
  const body = request.postData() ?? ""
  if (vendor === "ga4") {
    const lines = body ? body.split("\n").filter(Boolean) : [url.search.slice(1)]
    const events = lines.map(
      (line) => new URLSearchParams(line).get("en") ?? new URLSearchParams(url.search).get("en"),
    )
    const gcs = url.searchParams.get("gcs")
    return `${url.searchParams.get("tid")} events=[${events.join(",")}]${gcs ? ` gcs=${gcs}` : ""}`
  }
  if (vendor === "meta") return `${url.searchParams.get("id")} ev=${url.searchParams.get("ev")}`
  if (vendor === "tiktok") {
    const parsed = body.startsWith("{") ? JSON.parse(body) : {}
    return `${parsed.context?.pixel?.code ?? "?"} event=${parsed.event ?? "?"} ${url.pathname.replace("/api/v2/pixel", "")}`
  }
  return `${url.pathname}${url.search.slice(0, 80)}`
}

const browser = await chromium.launch()
const context = await browser.newContext({ serviceWorkers: "block" })
const hits = []

await context.route("**/*", async (route) => {
  const request = route.request()
  const url = request.url()
  const endpoint = collectionEndpoints.find((candidate) => candidate.test.test(url))
  const host = new URL(url).hostname
  // Only the SDK files themselves load from vendors. gtag also sends collection pings as
  // script requests, so "any script" would let those through.
  const isSdk = ["script", "stylesheet"].includes(request.resourceType()) && sdkFiles.test(url)
  const stray = !endpoint && !isSdk && vendorHosts.test(host)
  if (!endpoint && !stray) return route.continue()

  const requestOrigin = request.headers().origin ?? "*"
  const cors = {
    "access-control-allow-origin": requestOrigin,
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
  }
  if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors })
  hits.push({
    at: stamp(),
    line: `${request.method().padEnd(4)} ${endpoint ? describe(endpoint.vendor, request) : "(unlisted) " + url.slice(0, 100)}`,
    vendor: endpoint?.vendor ?? "other",
  })
  return route.fulfill({ status: 204, headers: cors })
})

const page = await context.newPage()
page.on("framenavigated", (frame) => {
  if (frame === page.mainFrame()) out(`${stamp()}  navigate ${frame.url()}`)
})
const flush = () => {
  for (const hit of hits.splice(0)) out(`${hit.at}  ${hit.vendor.padEnd(10)} ${hit.line}`)
}
const wait = async (ms) => {
  const timer = setInterval(flush, 100)
  await page.waitForTimeout(ms)
  clearInterval(timer)
  flush()
}

await page.goto(`${origin}/${path}`, { waitUntil: "load" })
await wait(3500)
if (action !== "none") {
  const button = page.locator(
    action === "accept" ? ".cm__btn[data-role=all]" : ".cm__btn[data-role=necessary]",
  )
  if (await button.count()) {
    out(`${stamp()}  click banner: ${action}`)
    await button.first().click()
  } else {
    out(`${stamp()}  no banner button found for ${action}`)
  }
  await wait(4500)
}
const cookies = (await context.cookies()).map((cookie) => cookie.name)
out(`${stamp()}  cookies: ${cookies.join(", ") || "(none)"}`)
await browser.close()
server.close()
