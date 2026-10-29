import { readFileSync, writeFileSync } from "node:fs"
const dir = "/home/pokerface/Documents/Projects/zinko.vendors-spike/packages/decoders/samples/"
const load = (n) => JSON.parse(readFileSync(`/tmp/vsp/spike/out-${n}.json`, "utf8")).log
const clean = (s) =>
  s
    .replaceAll("http://localhost:4438/", "https://shop.example/vendors-spike/")
    .replaceAll("http%3A%2F%2Flocalhost%3A4438%2F", "https%3A%2F%2Fshop.example%2Fvendors-spike%2F")
    .replaceAll("http%253A%252F%252Flocalhost%253A4438%252F", "https%253A%252F%252Fshop.example%252Fvendors-spike%252F")
    .replace(/"si":"[^"]+"/g, '"si":"TEST-SI-TOKEN"')
    .replace(/"huah":"[^"]*"/g, '"huah":"TEST"')
const save = (name, e) => {
  const o = { url: clean(e.url), method: e.method }
  if (e.body) o.body = clean(e.body)
  writeFileSync(dir + name + ".json", JSON.stringify(o, null, 2) + "\n")
}
const g = load("realgr"), gn = load("realnoeid"), pc = load("pincfg")
const f = (log, pred) => { const e = log.find(pred); if (!e) throw new Error("missing " + pred); return e }
const has = (s) => (e) => e.url.includes(s)
save("pinterest-init", f(g, (e) => has("ct.pinterest.com/v3/")(e) && e.url.includes("event=init")))
save("pinterest-user-config", f(g, (e) => has("ct.pinterest.com/user/")(e) && !e.url.includes("event=")))
save("pinterest-checkout-user", f(g, (e) => has("ct.pinterest.com/user/")(e) && e.url.includes("event=checkout")))
save("pinterest-checkout-user-noid", f(gn, (e) => has("ct.pinterest.com/user/")(e) && e.url.includes("event=checkout")))
save("pinterest-checkout-v3-stubconfig", f(pc, (e) => has("ct.pinterest.com/v3/")(e) && e.url.includes("event=checkout")))
