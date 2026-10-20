import { Auth } from "@repo/core/Auth"
import { Database } from "@repo/core/Database"
import { isAuditId } from "@repo/core/realtime-limits"
import { audit } from "@repo/db"
import { and, eq } from "drizzle-orm"
import { Effect } from "effect"
import { AuditRoomNamespace } from "../realtime/AuditRoom"
import { BetterAuth } from "./auth-live"
import { activeMembership } from "./org-access"
import type { WorkerRoute } from "./routes"
import { runtime } from "./runtime"

const pattern = /^\/ws\/audits\/([^/]+)$/

/**
 * Browsers attach cookies to cross-site WebSocket handshakes, so the page's origin must be the
 * app's own: the request URL's origin, or the configured `BETTER_AUTH_URL`.
 */
const isAllowedOrigin = (request: Request, baseURL: string | undefined) => {
  const origin = request.headers.get("Origin")
  if (origin === null || origin === "null") return false
  return (
    origin === new URL(request.url).origin ||
    (baseURL !== undefined && origin === new URL(baseURL).origin)
  )
}

const notFound = () => new Response("Not found", { status: 404 })

/**
 * WebSocket upgrades on `/ws/audits/<auditId>`. The id is validated, the origin checked (403), the
 * session resolved (401) and the audit looked up in an organization the user is a member of (404,
 * the same as a missing one) before the audit's Durable Object is touched. The room is named by
 * the id the database returns, so letter case in the URL cannot select another room.
 */
export const auditRoomRoute: WorkerRoute = async (request) => {
  const match = pattern.exec(new URL(request.url).pathname)
  if (match?.[1] === undefined) return undefined
  const auditId = match[1]
  if (!isAuditId(auditId)) return notFound()
  return runtime
    .runPromise(
      Effect.gen(function* () {
        const auth = yield* BetterAuth
        if (!isAllowedOrigin(request, auth.options.baseURL))
          return new Response("Forbidden", { status: 403 })
        const { sessionFromHeaders } = yield* Auth
        const session = yield* sessionFromHeaders(request.headers)
        const { organizationId } = yield* activeMembership(session)
        const { db } = yield* Database
        const rows = yield* db
          .select({ id: audit.id })
          .from(audit)
          .where(and(eq(audit.id, auditId), eq(audit.orgId, organizationId)))
          .limit(1)
        const found = rows[0]
        if (found === undefined) return notFound()
        const room = yield* AuditRoomNamespace
        return yield* room.byName(found.id).fetch(request)
      }).pipe(
        Effect.catchTags({
          Unauthorized: () => Effect.succeed(new Response("Unauthorized", { status: 401 })),
          NotAMember: () => Effect.succeed(notFound()),
        }),
        Effect.orElseSucceed(() => new Response("Audit room error", { status: 502 })),
      ),
    )
    .catch((error: unknown) => {
      // the runtime failed to build (a layer is misconfigured)
      console.error("Audit room unavailable:", error)
      return new Response("Server is not configured", { status: 500 })
    })
}
