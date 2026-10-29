// Static server for the scratch pages: / is page.html, /probe and /probe-deps are the probes.
import http from "node:http"
import { readFileSync } from "node:fs"

const pages = {
  "/probe-deps": "./probe-deps.html",
  "/probe": "./probe.html",
}
const pick = (url) => Object.entries(pages).find(([prefix]) => url.startsWith(prefix))?.[1] ?? "./page.html"

http
  .createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" })
    res.end(readFileSync(new URL(pick(req.url ?? "/"), import.meta.url)))
  })
  .listen(4437, "127.0.0.1")
