# Spike evidence (Task 0 and Task 1, 2026-10-29)

Reproducible inputs for the plan's "Task 1 results". Everything here uses test IDs and synthetic click
IDs; no real account, person or IP is involved. Run from the repository root with the fixtures
`playwright` dependency available (`packages/fixtures/node_modules`), Chromium installed, and the
network reachable for the SDK files only.

| File | What it is |
|---|---|
| `page.html` | The page with each vendor's published install snippet (LinkedIn Insight Tag, Microsoft UET, Pinterest Tag, Reddit Pixel, Snap Pixel), a purchase-like event on a button and after 3.5 s, and the consent variants (`?consent=granted`, `denied`, `update`; `?noeid=1` leaves out every dedup ID). The UET snippet's script source is `https://` (the published form is protocol-relative). Pinterest in `denied` calls `pintrk('setconsent', false)`, Reddit passes `optOut: true`, UET pushes `consent default` with `ad_storage: denied`. |
| `run.mjs` | Harness: serves `page.html` on :4438, drives Chromium and routes every non-local request. Only the SDK files (`sdkFiles` of `vendors.json`) go to the network; everything else is answered locally and logged with its disposition. Prints the log and writes `out-<label>.json`. `PINCFG='{}'` answers Pinterest's `/user/` config request with a stub `{}` JSON (the only way to see its `/v3/?event=` follower; never a real config). |
| `serve.mjs`, `probe.html`, `probe-deps.html` | Static server on :4437 and two probe pages: preflight, redirect, unlisted-path and beacon cases for the five vendors' hosts; and the vendors' own sites' dependencies (documents, embeds, images) that must not be intercepted. |
| `eng.mjs` | Posts one `CaptureRequest` to an engine's `/capture` and prints every non-local request with its status, `blocked` flag and whether it is an SDK file. |
| `mk.mjs`, `mk-pinterest.mjs` | Write the samples in `packages/decoders/samples/` from the harness output (page URL rewritten to `https://shop.example/vendors-spike/`). |
| `sdk-hashes.txt` | SHA-256, size and URL of each SDK file fetched on 2026-10-29. |

## Versions seen

| Vendor | SDK file (sha256 prefix, bytes) | Version strings on the wire |
|---|---|---|
| LinkedIn | `insight.min.js` (`6bf57277`, 62285) | `scriptVersion: 1000039` |
| Microsoft | `bat.js` (`0bcd6648`, 58485) | `Ver=2`, `sv=2` |
| Pinterest | `ct/core.js` (`8eb28a31`, 2282) then `ct/lib/main.c61fa7c9.js` (`3386ba7b`, 48016) | `mh=c61fa7c9` |
| Reddit | `ads/pixel.js` (`db76fdc5`, 24302; served gzipped even for `accept-encoding: identity`) | `v=rdt_d3960254` |
| Snap | `scevent.min.js` (`f3d0525b`, 59535) | `v=3.61.0-2610191940` |

Full hashes are in `sdk-hashes.txt`. These files change; a later run may differ.

## Commands

```sh
# 1. harness: SDK files only reach the network, the rest is answered locally
VENDORS_JSON=apps/browser/src/inject/vendors.json node run.mjs "consent=granted" granted
node run.mjs "consent=denied" denied
node run.mjs "consent=update" update            # UET default denied, update to granted after 2.5 s
node run.mjs "consent=granted&noeid=1" noeid    # no dedup IDs
PINCFG='{}' node run.mjs "consent=granted" pincfg  # Pinterest /v3/ checkout needs a (stub) config answer

# 2. engines (own ports; ALLOW_PRIVATE_NETWORKS lets them reach localhost)
(cd apps/browser && ALLOW_PRIVATE_NETWORKS=true PORT=8090 node --experimental-strip-types src/server.ts)
(cd apps/browser && CAPTURE_ENGINE=playwright ALLOW_PRIVATE_NETWORKS=true PORT=8092 node --experimental-strip-types src/server.ts)
node serve.mjs
node eng.mjs http://localhost:8090 "http://localhost:4437/?consent=granted"
node eng.mjs http://localhost:8090 http://localhost:4437/probe '{"scenario":"none"}'
node eng.mjs http://localhost:8090 http://localhost:4437/probe-deps '{"scenario":"none"}'

# 3. regression (see ../regression.md)
../baseline/capture.sh <out-dir> http://localhost:<engine> http://localhost:<fixtures> <site>...
```

`run.mjs` resolves `playwright` and reads `VENDORS_JSON` (default `apps/browser/src/inject/vendors.json`); run
it from a directory where `playwright` resolves (for example by setting `NODE_PATH` to
`packages/fixtures/node_modules`, or copying the files next to it).
