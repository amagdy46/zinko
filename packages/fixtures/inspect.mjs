// Usage: pnpm --filter @repo/fixtures inspect <site>[/page] [accept|reject]
// Opens a fixture site on a private server, answers vendor collection requests with 204 so
// nothing reaches the vendors, clicks the banner and prints every vendor request with its time.
import { isSdkFile, isVendorHost } from "@repo/capture-contract"
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
  // Candidate endpoints for the plan's five new vendors (spike): the inspector answers them
  // locally and prints them; they are not the decoders' list.
  { vendor: "linkedin", test: /^https:\/\/(px|dc)\.ads\.linkedin\.com\// },
  { vendor: "microsoft", test: /^https:\/\/bat\.bing\.(com|net)\/action\// },
  { vendor: "pinterest", test: /^https:\/\/ct\.pinterest\.com\// },
  { vendor: "reddit", test: /^https:\/\/alb\.reddit\.com\// },
  { vendor: "snap", test: /^https:\/\/tr\.snapchat\.com\// },
]

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

const fields = (params, names) =>
  names
    .filter(([key]) => params.get(key) !== null)
    .map(([key, label]) => `${label}=${params.get(key)}`)
    .join(" ")

function describe(vendor, request) {
  const url = new URL(request.url())
  const body = request.postData() ?? ""
  if (vendor === "ga4") {
    const lines = body ? body.split("\n").filter(Boolean) : [""]
    const events = lines.map((line) => {
      const params = new URLSearchParams(url.search)
      for (const [key, value] of new URLSearchParams(line)) params.set(key, value)
      const detail = fields(params, [
        ["ep.transaction_id", "transaction_id"],
        ["epn.value", "value"],
        ["cu", "currency"],
      ])
      return `${params.get("en")}${detail ? `(${detail})` : ""}`
    })
    const gcs = url.searchParams.get("gcs")
    return `${url.searchParams.get("tid")} events=[${events.join(", ")}]${gcs ? ` gcs=${gcs}` : ""} dl=${url.searchParams.get("dl")}`
  }
  if (vendor === "meta") {
    const detail = fields(url.searchParams, [
      ["eid", "eventID"],
      ["fbc", "fbc"],
      ["cd[value]", "value"],
      ["cd[currency]", "currency"],
    ])
    return `${url.searchParams.get("id")} ev=${url.searchParams.get("ev")} ${detail} dl=${url.searchParams.get("dl")}`
  }
  if (vendor === "tiktok") {
    const parsed = body.startsWith("{") ? JSON.parse(body) : {}
    return `${parsed.context?.pixel?.code ?? "?"} event=${parsed.event ?? "?"} ${url.pathname.replace("/api/v2/pixel", "")}`
  }
  if (["linkedin", "microsoft", "pinterest", "reddit", "snap"].includes(vendor)) {
    const raw = body.startsWith("{") ? ` body=${body.slice(0, 160)}` : ""
    return `${url.host}${url.pathname} ${[...url.searchParams.keys()].join(",")}${raw}`
  }
  const detail = fields(url.searchParams, [
    ["label", "label"],
    ["oid", "transaction_id"],
    ["value", "value"],
    ["currency_code", "currency"],
    ["npa", "npa"],
  ])
  return `${url.pathname.slice(0, 40)} ${detail}`
}

const browser = await chromium.launch()
const context = await browser.newContext({ serviceWorkers: "block" })
const hits = []

await context.route("**/*", async (route) => {
  const request = route.request()
  const url = request.url()
  const endpoint = collectionEndpoints.find((candidate) => candidate.test.test(url))
  // First-party collection (server_container_url): answered by the fixture server itself.
  if (url.startsWith(origin) && new URL(url).pathname === "/g/collect") {
    const response = await route.fetch()
    hits.push({
      at: stamp(),
      line: `${request.method().padEnd(4)} ${describe("ga4", request)} -> ${response.status()} (first-party)`,
      vendor: "ga4",
    })
    return route.fulfill({ response })
  }
  // Only the SDK files themselves load from vendors, whatever their resource type.
  const stray = !endpoint && !isSdkFile(url) && isVendorHost(url)
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
