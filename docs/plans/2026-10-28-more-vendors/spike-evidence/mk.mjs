import { readFileSync, writeFileSync } from "node:fs"
const dir = "packages/decoders/samples/"
const load = (n) => JSON.parse(readFileSync(`./out-${n}.json`, "utf8")).log
const clean = (s) =>
  s
    .replaceAll("http://localhost:4437/", "https://shop.example/vendors-spike/")
    .replaceAll("http%3A%2F%2Flocalhost%3A4437%2F", "https%3A%2F%2Fshop.example%2Fvendors-spike%2F")
    .replaceAll("http%253A%252F%252Flocalhost%253A4437%252F", "https%253A%252F%252Fshop.example%252Fvendors-spike%252F")
    .replace(/"si":"[^"]+"/g, '"si":"TEST-SI-TOKEN"')
    .replace(/"huah":"[^"]*"/g, '"huah":"TEST"')
const save = (name, e) => {
  const o = { url: clean(e.url), method: e.method }
  if (e.body) o.body = clean(e.body)
  writeFileSync(dir + name + ".json", JSON.stringify(o, null, 2) + "\n")
}
const g = load("granted"), d = load("denied"), pc = load("pincfg")
const f = (log, pred) => { const e = log.find(pred); if (!e) throw new Error("missing " + pred); return e }
const has = (s) => (e) => e.url.includes(s)
save("linkedin-PageView", f(g, (e) => has("px.ads.linkedin.com/collect")(e) && !e.url.includes("conversionId")))
save("linkedin-conversion", f(g, (e) => has("px.ads.linkedin.com/collect")(e) && e.url.includes("conversionId")))
save("microsoft-pageLoad", f(g, (e) => has("/action/0")(e) && e.url.includes("evt=pageLoad")))
save("microsoft-custom", f(g, (e) => has("/action/0")(e) && e.url.includes("evt=custom")))
save("microsoft-consent-default", f(g, (e) => has("/actionp/0")(e)))
save("microsoft-pageLoad-denied", f(d, (e) => has("/action/0")(e) && e.url.includes("evt=pageLoad")))
save("microsoft-custom-denied", f(d, (e) => has("/action/0")(e) && e.url.includes("evt=custom")))
save("pinterest-init", f(pc, (e) => has("ct.pinterest.com/v3/")(e) && e.url.includes("event=init")))
save("pinterest-checkout", f(pc, (e) => has("ct.pinterest.com/v3/")(e) && e.url.includes("event=checkout")))
save("reddit-PageVisit", f(g, (e) => has("alb.reddit.com/rp")(e) && e.url.includes("event=PageVisit")))
save("reddit-Purchase", f(g, (e) => has("alb.reddit.com/rp")(e) && e.url.includes("event=Purchase")))
save("reddit-Purchase-optout", f(d, (e) => has("alb.reddit.com/rp")(e) && e.url.includes("event=Purchase")))
const snaps = g.filter((e) => e.url === "https://tr.snapchat.com/p")
save("snap-PAGE_VIEW", snaps.find((e) => e.body.includes('"ev":"PAGE_VIEW"')))
save("snap-PURCHASE", snaps.find((e) => e.body.includes('"ev":"PURCHASE"')))
