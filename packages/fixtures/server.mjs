import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { renderPage } from "./page.mjs"
import { defaults, sites } from "./sites.mjs"

const root = import.meta.dirname
const pages = { "": "home", product: "product", "thank-you": "thank-you" }
const staticFiles = {
  "/_shared/tags.js": ["shared/tags.js", "text/javascript"],
  "/_shared/consent.js": ["shared/consent.js", "text/javascript"],
  "/_vendor/meta-pixel/snippet.js": ["vendor/meta-pixel/snippet.js", "text/javascript"],
  "/_vendor/tiktok-pixel/snippet.js": ["vendor/tiktok-pixel/snippet.js", "text/javascript"],
  "/_vendor/cookieconsent/cookieconsent.umd.js": [
    "vendor/cookieconsent/cookieconsent.umd.js",
    "text/javascript",
  ],
  "/_vendor/cookieconsent/cookieconsent.css": [
    "vendor/cookieconsent/cookieconsent.css",
    "text/css",
  ],
}

function send(res, status, headers, body) {
  res.writeHead(status, { "cache-control": "no-store", ...headers })
  res.end(body)
}

function handle(req, res) {
  const url = new URL(req.url ?? "/", "http://localhost")
  const path = url.pathname

  if (path === "/") {
    const links = Object.keys(sites)
      .map((name) => `<li><a href="/${name}/">${name}</a></li>`)
      .join("")
    return send(
      res,
      200,
      { "content-type": "text/html; charset=utf-8" },
      `<h1>Zinko fixtures</h1><ul>${links}</ul>`,
    )
  }

  if (path === "/r") {
    const to = url.searchParams.get("to")
    if (!to || !/^[\x21-\x7e]+$/.test(to)) {
      return send(res, 400, { "content-type": "text/plain" }, "missing or invalid ?to=")
    }
    return send(res, 302, { location: to }, "")
  }

  if (path === "/g/collect") {
    return send(res, 500, { "content-type": "text/plain" }, "collection endpoint failed")
  }

  const file = staticFiles[path]
  if (file) {
    return readFile(join(root, file[0]), "utf8").then((body) =>
      send(
        res,
        200,
        { "content-type": `${file[1]}; charset=utf-8` },
        // a second copy of the Meta snippet must fetch fbevents.js again, not reuse the cached one
        url.searchParams.has("copy") ? body.replace("fbevents.js", "fbevents.js?copy=2") : body,
      ),
    )
  }

  const [, name = "", rest = "", ...extra] = path.split("/")
  if (!Object.hasOwn(sites, name) || extra.length > 0) {
    return send(res, 404, { "content-type": "text/plain" }, "not found")
  }
  const flags = { ...defaults, ...sites[name] }

  if (rest === "go" && flags.adEntry) {
    return send(res, 302, { location: `/r?to=${encodeURIComponent(`/${name}/`)}` }, "")
  }
  if (rest === "go-keep-fbclid" && flags.adEntry) {
    const fbclid = url.searchParams.get("fbclid")
    const target = fbclid === null ? `/${name}/` : `/${name}/?fbclid=${encodeURIComponent(fbclid)}`
    return send(res, 302, { location: `/r?to=${encodeURIComponent(target)}` }, "")
  }
  if (!Object.hasOwn(pages, rest))
    return send(res, 404, { "content-type": "text/plain" }, "not found")

  const gpcHeader = req.headers["sec-gpc"]
  const body = renderPage({ name, page: pages[rest], flags, query: url.search, gpcHeader })
  const headers = { "content-type": "text/html; charset=utf-8" }
  if (flags.gpcEcho) headers["x-sec-gpc-received"] = gpcHeader ?? "(not sent)"
  return send(res, 200, headers, body)
}

export function startServer(port) {
  const server = createServer((req, res) => {
    Promise.resolve()
      .then(() => handle(req, res))
      .catch((error) => {
        console.error(error)
        if (!res.headersSent) send(res, 500, { "content-type": "text/plain" }, "error")
      })
  })
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await startServer(Number(process.env.FIXTURES_PORT ?? 4400))
  process.stdout.write(`fixtures on http://localhost:${server.address().port}\n`)
}
