// Run by `pnpm check`: the checked-in sample report (apps/web/src/lib/sample-report.ts) still
// decodes against the current ReportModel and passes the same projection check a real report does.
// To regenerate it after a model change, see the header of that file.
import { registerHooks } from "node:module"
import { dirname, join, resolve as resolvePath } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = resolvePath(dirname(fileURLToPath(import.meta.url)), "..")
const src = `${pathToFileURL(join(root, "apps/web/src")).href}/`

// The app's modules import each other without file extensions and through the "@/" alias, which
// Node resolves neither of.
const withTs = (specifier) => (/\.[a-z]+$/.test(specifier) ? specifier : `${specifier}.ts`)
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@/")) return next(src + withTs(specifier.slice(2)), context)
    if (specifier.startsWith(".")) return next(withTs(specifier), context)
    return next(specifier, context)
  },
})

const lib = (name) => pathToFileURL(join(root, "apps/web/src/lib", name)).href
const { Effect } = await import("effect")
const { decodeReportModel } = await import(lib("report-model.ts"))
const { assertProjected } = await import(lib("report-projection.ts"))
const { sampleReport } = await import(lib("sample-report.ts"))

try {
  const model = await Effect.runPromise(decodeReportModel(sampleReport))
  await Effect.runPromise(assertProjected(model, model.detail))
} catch (error) {
  console.error("The sample report no longer matches the report model:", String(error))
  console.error("Regenerate it: see the header of apps/web/src/lib/sample-report.ts")
  process.exit(1)
}
