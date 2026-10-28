import { Auth } from "@repo/core/Auth"
import { isAuditId } from "@repo/core/realtime-limits"
import { Effect } from "effect"
import { activeMembership } from "./org-access"
import { registerOf } from "./register-data"
import type { WorkerRoute } from "./routes"
import { runtime } from "./runtime"

const pattern = /^\/api\/audits\/([^/]+)\/register\.csv$/

const notFound = () => new Response("Not found", { status: 404 })

/** A file name part from the host: lower-case letters, digits, dots and hyphens only. */
const safeHost = (host: string) => host.toLowerCase().replaceAll(/[^a-z0-9.-]/g, "-")

/**
 * `GET /api/audits/<auditId>/register.csv`: the audit register as a download, for a member of the
 * audit's organization. The session is resolved, then the membership, then the audit in that
 * organization; every failure is the same 404, so the route says nothing about which audits exist.
 */
export const registerRoute: WorkerRoute = async (request) => {
  const match = pattern.exec(new URL(request.url).pathname)
  if (match?.[1] === undefined || request.method !== "GET") return undefined
  const auditId = match[1]
  if (!isAuditId(auditId)) return notFound()
  return runtime
    .runPromise(
      Effect.gen(function* () {
        const { sessionFromHeaders } = yield* Auth
        const session = yield* sessionFromHeaders(request.headers)
        const { organizationId } = yield* activeMembership(session)
        const register = yield* registerOf(organizationId, auditId)
        return new Response(register.csv, {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="zinko-register-${safeHost(register.host)}-${register.date}.csv"`,
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
          },
        })
      }).pipe(
        Effect.catchTags({
          Unauthorized: () => Effect.succeed(notFound()),
          NotAMember: () => Effect.succeed(notFound()),
          NotFound: () => Effect.succeed(notFound()),
        }),
        Effect.orElseSucceed(() => new Response("Register error", { status: 502 })),
      ),
    )
    .catch((error: unknown) => {
      console.error("Register unavailable:", error)
      return new Response("Server is not configured", { status: 500 })
    })
}
