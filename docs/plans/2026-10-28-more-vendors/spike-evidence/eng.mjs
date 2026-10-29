// Posts one CaptureRequest to an engine and prints the raw request list: host, path, method, type, status, blocked.
const out = (line) => process.stdout.write(`${line}\n`)
const [engine, url, extra = "{}"] = process.argv.slice(2)
const res = await fetch(`${engine}/capture`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ url, scenario: "none", viewport: "desktop", blockVendorRequests: true, ...JSON.parse(extra) }),
})
const j = await res.json()
const body = j.result ?? j
out("HTTP", res.status, "engine", body.engine?.name, "fallback", body.engine?.fallbackReason)
const vendor = JSON.parse(await (await import("node:fs")).promises.readFile(process.env.VENDORS_JSON ?? "apps/browser/src/inject/vendors.json", "utf8"))
const sdk = new RegExp(vendor.sdkFiles)
for (const r of body.requests ?? []) {
  const u = new URL(r.url)
  if (u.hostname === "localhost") continue
  out(`${String(Math.round(r.startedAt)).padStart(6)}ms ${r.method.padEnd(7)} ${r.resourceType.padEnd(8)} status=${String(r.status).padEnd(4)} blocked=${String(r.blocked).padEnd(5)} ${sdk.test(r.url) ? "SDK " : "    "} ${u.host}${u.pathname}${u.search ? "?…" : ""}`)
}
if (process.env.DUMP) await (await import("node:fs")).promises.writeFile(process.env.DUMP, JSON.stringify(body))
