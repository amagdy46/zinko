// Checks the collection endpoints to the capture engine, which blocks them with
// `blockVendorRequests`. Its image builds from `apps/browser` alone and its Python engine cannot
// import this package, so it reads a copy: `apps/browser/src/inject/collection.json`. Run by
// `build`, after `tsc`; pass --write to regenerate the copy, then format it.
import { readFileSync, writeFileSync } from "node:fs"
import { COLLECTION_ENDPOINTS } from "../dist/index.js"

const target = new URL("../../../apps/browser/src/inject/collection.json", import.meta.url)
const endpoints = COLLECTION_ENDPOINTS.map(({ methods, path, query }) => ({
  methods,
  path,
  query,
}))
if (process.argv.includes("--write")) {
  writeFileSync(target, `${JSON.stringify({ endpoints }, null, 2)}\n`)
} else if (
  JSON.stringify(JSON.parse(readFileSync(target, "utf8"))) !== JSON.stringify({ endpoints })
) {
  throw new Error(
    "Collection endpoints are stale: run node packages/decoders/scripts/engine-endpoints.mjs --write and pnpm format",
  )
}
