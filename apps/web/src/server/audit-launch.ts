import { Jobs } from "@repo/core"
import { Database } from "@repo/core/Database"
import { audit } from "@repo/db"
import { and, eq, inArray, isNull } from "drizzle-orm"
import { Effect } from "effect"
import { ACTIVE_STATUSES } from "./audit-fence"

/** Whether a failed `create` only says the instance exists (Miniflare and Cloudflare: `instance.already_exists`). */
const alreadyExists = (cause: unknown): boolean => {
  let current = cause
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth++) {
    const text = "message" in current ? String(current.message) : ""
    if (text.includes("instance.already_exists") || text.includes("already exists")) return true
    current = "cause" in current ? current.cause : undefined
  }
  return false
}

/**
 * Starts the audit's workflow, named by the audit id: a second start for the same audit finds the
 * instance there and changes nothing. A failed start leaves the audit `queued` (the error is
 * logged); no status lookup decides anything, and the audit is never marked `failed` here.
 * `reconcileActive` relaunches an audit whose start never happened and settles one that never
 * runs. The pointer is only written to an active audit that has none.
 */
export const launchAudit = (auditId: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const jobs = yield* Jobs
    const point = (workflowId: string) =>
      db
        .update(audit)
        .set({ workflowId })
        .where(
          and(
            eq(audit.id, auditId),
            isNull(audit.workflowId),
            inArray(audit.status, [...ACTIVE_STATUSES]),
          ),
        )
    yield* jobs.start("audit", { auditId }, { id: auditId }).pipe(
      Effect.flatMap((instance) => point(instance.id)),
      Effect.catchTag("JobError", (error) =>
        alreadyExists(error)
          ? point(auditId)
          : Effect.logError("Audit workflow did not start", error),
      ),
    )
  })
