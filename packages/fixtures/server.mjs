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

// Sites that change between audits keep their state here, so only an explicit POST moves them and a restart resets them.
const releaseOf = new Map()
const flakyOf = new Map()

function flagsOf(name) {
  const { releases, flaky, ...own } = sites[name]
  let flags = { ...defaults, ...own }
  if (releases) flags = { ...flags, ...releases[releaseOf.get(name) ?? 0] }
  if (flaky) flags = { ...flags, ...flaky[flakyVerdict(name)] }
  return flags
}

function flakyVerdict(name) {
  const { verdicts, epoch } = flakyOf.get(name) ?? { verdicts: ["pass"], epoch: 0 }
  return verdicts[Math.min(epoch, verdicts.length - 1)]
}

function sendJson(res, status, body) {
  send(res, status, { "content-type": "application/json" }, JSON.stringify(body))
}

function handleControl(req, res, url) {
  const path = url.pathname
  const site = path.startsWith("/_release/")
    ? path.slice("/_release/".length)
    : url.searchParams.get("site")
  const kind = path.startsWith("/_release/") ? "releases" : "flaky"
  if (!site || !Object.hasOwn(sites, site) || !sites[site][kind]) {
    return sendJson(res, 404, {
      error: `no ${kind === "releases" ? "release" : "flaky"} site ${site}`,
    })
  }
  const state = () =>
    kind === "releases"
      ? { site, release: releaseOf.get(site) ?? 0, releases: sites[site].releases.length }
      : {
          site,
          ...(flakyOf.get(site) ?? { verdicts: ["pass"], epoch: 0 }),
          verdict: flakyVerdict(site),
        }

  if (req.method === "GET" && (kind === "releases" || path === "/_flaky/state")) {
    return sendJson(res, 200, state())
  }
  if (req.method !== "POST") return sendJson(res, 405, { error: "use POST to change state" })

  if (kind === "releases") {
    const to = Number(url.searchParams.get("to"))
    if (!Number.isInteger(to) || to < 0 || to >= sites[site].releases.length) {
      return sendJson(res, 400, { error: `?to= must be 0 to ${sites[site].releases.length - 1}` })
    }
    releaseOf.set(site, to)
  } else if (path === "/_flaky/script") {
    const verdicts = (url.searchParams.get("verdicts") ?? "").split(",")
    if (!verdicts.every((verdict) => verdict === "pass" || verdict === "fail")) {
      return sendJson(res, 400, { error: "?verdicts= is a comma list of pass and fail" })
    }
    flakyOf.set(site, { verdicts, epoch: 0 })
  } else if (path === "/_flaky/next") {
    const current = flakyOf.get(site) ?? { verdicts: ["pass"], epoch: 0 }
    flakyOf.set(site, { ...current, epoch: current.epoch + 1 })
  } else {
    return sendJson(res, 404, { error: "not found" })
  }
  return sendJson(res, 200, state())
}

function send(res, status, headers, body) {
  res.writeHead(status, { "cache-control": "no-store", ...headers })
  res.end(body)
}

async function handle(req, res) {
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

  if (path.startsWith("/_release/") || path.startsWith("/_flaky/")) {
    return handleControl(req, res, url)
  }

  // A GET page that submits a POST form by itself, to test the reload step: `/post-form/timed`
  // after `?after=<ms>` (default 500), `/post-form/pagehide` when the page is hidden or left.
  if (path === "/post-form/timed" || path === "/post-form/pagehide") {
    const after = Math.min(Number(url.searchParams.get("after")) || 500, 30_000)
    const trigger =
      path === "/post-form/timed"
        ? `setTimeout(() => form.submit(), ${after})`
        : `addEventListener("pagehide", () => form.submit())`
    return send(
      res,
      200,
      { "content-type": "text/html; charset=utf-8" },
      `<!doctype html><title>post-form</title><form id="f" method="post" action="/post-form/received"></form><script>const form = document.getElementById("f"); ${trigger}</script>`,
    )
  }
  if (path === "/post-form/received")
    return send(
      res,
      200,
      { "content-type": "text/html; charset=utf-8" },
      `<!doctype html><title>received</title><h1>received by ${req.method}</h1>`,
    )

  if (path === "/r") {
    const to = url.searchParams.get("to")
    if (!to || !/^[\x21-\x7e]+$/.test(to)) {
      return send(res, 400, { "content-type": "text/plain" }, "missing or invalid ?to=")
    }
    return send(res, 302, { location: to }, "")
  }

  if (path === "/server-error/") {
    return send(
      res,
      500,
      { "content-type": "text/html; charset=utf-8" },
      "<!doctype html><title>Server error</title><h1>Something went wrong</h1>",
    )
  }

  if (path === "/g/collect") {
    return send(res, 500, { "content-type": "text/plain" }, "collection endpoint failed")
  }

  if (path.endsWith("/g/collect")) return send(res, 204, {}, "")

  // consent-cmp-404: the banner library cannot be fetched once its cookie says a choice was made
  const broken = url.searchParams.get("site")
  if (
    path === "/_vendor/cookieconsent/cookieconsent.umd.js" &&
    broken !== null &&
    Object.hasOwn(sites, broken) &&
    sites[broken].cmpBreaksAfterChoice === true &&
    (req.headers.cookie ?? "").includes("cc_cookie=")
  )
    return send(res, 404, { "content-type": "text/plain" }, "not found")

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
  const flags = flagsOf(name)

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

  // ?delay=<ms> holds the response, for timing checks against the capture deadline
  const delay = Math.min(Number(url.searchParams.get("delay")) || 0, 300_000)
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))

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
