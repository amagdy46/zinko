// Throwaway spike harness. Serves page.html, runs it in Chromium, lets ONLY the SDK script files
// through to the network and answers every other non-local request locally. Prints the network log.
const out = (line) => process.stdout.write(`${line}\n`)
import http from "node:http"
import { readFileSync, writeFileSync } from "node:fs"
import { chromium } from "playwright"

const vendors = JSON.parse(readFileSync(process.env.VENDORS_JSON ?? "apps/browser/src/inject/vendors.json", "utf8"))
const sdk = new RegExp(vendors.sdkFiles)
const page = readFileSync(new URL("./page.html", import.meta.url))
const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" })
  res.end(page)
})
await new Promise((r) => server.listen(4438, "127.0.0.1", r))

const query = process.argv[2] ?? "consent=granted"
const label = process.argv[3] ?? "granted"
const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64")
const browser = await chromium.launch()
const context = await browser.newContext({ serviceWorkers: "block" })
const log = []
await context.route("**/*", async (route) => {
  const request = route.request()
  const url = request.url()
  const u = new URL(url)
  if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue()
  const entry = {
    t: Date.now(), method: request.method(), url, type: request.resourceType(),
    body: request.postData() ?? undefined,
    cookieHeader: undefined,
  }
  if (sdk.test(url)) {
    log.push({ ...entry, disposition: "SDK file, fetched from the network" })
    return route.continue()
  }
  const cors = {
    "access-control-allow-origin": request.headers().origin ?? "*",
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
  }
  log.push({ ...entry, disposition: "answered locally" })
  if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors })
  if (process.env.PINCFG && u.host === "ct.pinterest.com" && u.pathname === "/user/") return route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: process.env.PINCFG })
  if (request.resourceType() === "image") return route.fulfill({ status: 200, contentType: "image/gif", headers: cors, body: gif })
  if (request.resourceType() === "script") return route.fulfill({ status: 200, contentType: "text/javascript", headers: cors, body: "" })
  return route.fulfill({ status: 204, headers: cors })
})
const p = await context.newPage()
const lands = process.argv[4] ?? "li_fat_id=1c4b7e2a-6d0f-4a3b-9a5e-2f8d1c7b9e30&msclkid=3f9a1c2b7d8e4f5a6b0c1d2e3f4a5b6c&epik=dj0yJnU9Wmlua29UZXN0VXNlcjAwMDEmcD0wJm49WmlOa29UZXN0QWRzJnQ9QUFBQUFBQm8mZz1BQUFBQUFB&rdt_cid=9aZxQ2LmN4pR7sT1uVw3&ScCid=7c1e5a90-3b2d-4f68-8a1b-0d9e6f4c2a73"
await p.goto(`http://localhost:4438/?${query}&${lands}`, { waitUntil: "load" })
await p.waitForTimeout(8000)
const cookies = (await context.cookies()).map((c) => ({ name: c.name, value: c.value.slice(0, 80), domain: c.domain, path: c.path, days: c.expires > 0 ? Math.round((c.expires - Date.now() / 1000) / 86400 * 10) / 10 : "session", sameSite: c.sameSite, secure: c.secure }))
const storage = await p.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }))
writeFileSync(`./out-${label}.json`, JSON.stringify({ query, log, cookies, storage }, null, 1))
const t0 = log[0]?.t ?? 0
for (const e of log) out(`${String(e.t - t0).padStart(5)}ms ${e.method.padEnd(7)} ${e.type.padEnd(8)} [${e.disposition}] ${e.url.length > 260 ? e.url.slice(0, 260) + "..." : e.url}${e.body ? "\n         body: " + e.body.slice(0, 400) : ""}`)
out("cookies:", JSON.stringify(cookies))
out("storage:", JSON.stringify(storage))
await browser.close()
server.close()
