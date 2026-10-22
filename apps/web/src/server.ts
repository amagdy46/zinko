import handler from "@tanstack/react-start/server-entry"
import { type WorkerRoute, workerRoutes } from "./server/routes"

/**
 * The Worker entry (`main` in wrangler.jsonc). Cloudflare requires Durable Object and Workflow
 * classes to be exported from here: `efforge add` appends their re-exports to the end of this file.
 */
export default {
  fetch(request: Request): Promise<Response> {
    return tryRoutes(workerRoutes, request)
  },
}

/**
 * Tries each worker route in order; the first defined response wins. Recursive rather than a
 * loop so the awaits stay sequential: a later route must not run once an earlier one answers.
 */
const tryRoutes = (routes: ReadonlyArray<WorkerRoute>, request: Request): Promise<Response> => {
  const [head, ...tail] = routes
  if (head === undefined) return Promise.resolve(handler.fetch(request))
  return head(request).then((response) => response ?? tryRoutes(tail, request))
}
export { Audit } from "./workflows/Audit"
export { AuditRoom } from "./realtime/AuditRoom"
export { BrowserContainer } from "./browser/BrowserContainer"
export { AdmissionGate } from "./browser/AdmissionGate"
