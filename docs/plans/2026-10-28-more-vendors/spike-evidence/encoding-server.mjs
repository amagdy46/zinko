// Serves a tiny JS file under each content-encoding over https on 127.0.0.1:4450 (cert from
// the environment: ENC_CERT, ENC_KEY) and a page on http://localhost:4451/ that loads them all.
import http from "node:http"
import https from "node:https"
import { readFileSync } from "node:fs"
import zlib from "node:zlib"

const script = (name) => Buffer.from(`window.__sdk=(window.__sdk||[]).concat(["${name}"]);`)
const gz = zlib.gzipSync(script("gzip"))
const variants = {
  identity: [script("identity"), undefined],
  gzip: [gz, "gzip"],
  br: [zlib.brotliCompressSync(script("br")), "br"],
  deflate: [zlib.deflateSync(script("deflate")), "deflate"],
  "deflate-raw": [zlib.deflateRawSync(script("deflate-raw")), "deflate"],
  "gzip-truncated": [gz.subarray(0, gz.length - 12), "gzip"],
  "br-garbage": [Buffer.from("not brotli at all"), "br"],
  "unknown-encoding": [script("x"), "compress"],
}
https
  .createServer({ key: readFileSync(process.env.ENC_KEY), cert: readFileSync(process.env.ENC_CERT) }, (req, res) => {
    const [body, encoding] = variants[(req.url ?? "").replace("/sdk-", "").replace(".js", "")] ?? []
    if (body === undefined) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { "content-type": "application/javascript", ...(encoding ? { "content-encoding": encoding } : {}) })
    res.end(body)
  })
  .listen(4450, "127.0.0.1")

const names = Object.keys(variants)
const page = `<!doctype html><title>encodings</title><script>
var R = {};
function done(n, v) { R[n] = v; document.title = JSON.stringify(R); }
</script>${names.map((n) => `<script src="https://127.0.0.1:4450/sdk-${n}.js" onload="done('${n}', (window.__sdk||[]).indexOf('${n}')>=0 ? 'ran' : 'loaded, did not run')" onerror="done('${n}', 'load failed')"></script>`).join("\n")}`
http.createServer((_req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(page) }).listen(4451, "127.0.0.1")
