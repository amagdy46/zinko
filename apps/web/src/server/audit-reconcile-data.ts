import { Jobs } from "@repo/core"
import { Database } from "@repo/core/Database"
import { audit } from "@repo/db"
import { and, eq, inArray } from "drizzle-orm"
import { Effect, Option } from "effect"
import { ACTIVE_STATUSES } from "./audit-fence"
import { launchAudit } from "./audit-launch"
import { settleAudit } from "./audit-settle"

/**
 * The longest a live workflow stays silent is one retry delay plus one attempt, 36 minutes (every
 * attempt of every step records `progress_at` first); 2.5 times that is when an unreachable one is
 * given up. Correctness does not rest on the number: the fence makes a wrong settlement harmless.
 */
export const STALE_AFTER_MS = 90 * 60_000
/** A queued audit whose `launchAudit` never ran (the Worker died after the commit). */
export const ORPHAN_AFTER_MS = 5 * 60_000

type Outcome = "settled" | "relaunched" | "left"

/**
 * Closes or restarts the organization's active audits that cannot finish on their own. The first
 * rule that applies wins: (1) a stale heartbeat (`progress_at`, else `created_at`) settles the
 * audit without asking the binding; (2) a workflow whose status was read successfully as
 * `errored`, `terminated`, or `complete` while the row is still active settles it; (3) a queued
 * audit that never launched is launched again. Anything else changes nothing, and a failed or
 * lossy status lookup (including Miniflare's `instance.not_found`, which any internal failure
 * produces) is never a reason to settle.
 */
export const reconcileActive = (orgId: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const jobs = yield* Jobs
    const active = yield* db
      .select({
        id: audit.id,
        status: audit.status,
        workflowId: audit.workflowId,
        progressAt: audit.progressAt,
        createdAt: audit.createdAt,
      })
      .from(audit)
      .where(and(eq(audit.orgId, orgId), inArray(audit.status, [...ACTIVE_STATUSES])))
      .limit(20)
    const now = Date.now()
    const outcomes = new Map<string, Outcome>()
    for (const row of active) {
      const observed = { workflowId: row.workflowId, progressAt: row.progressAt, error: null }
      const silentFor = now - (row.progressAt ?? row.createdAt).getTime()
      if (silentFor > STALE_AFTER_MS) {
        if ((yield* settleAudit(orgId, row.id, observed)) !== null) outcomes.set(row.id, "settled")
        continue
      }
      if (row.workflowId !== null) {
        const read = yield* jobs.status("audit", row.workflowId).pipe(Effect.option)
        const status = Option.getOrUndefined(read)
        if (
          status !== undefined &&
          (status.status === "errored" ||
            status.status === "terminated" ||
            status.status === "complete")
        ) {
          const settled = yield* settleAudit(orgId, row.id, {
            ...observed,
            error: status.error ?? null,
          })
          if (settled !== null) outcomes.set(row.id, "settled")
        }
        continue
      }
      if (
        row.status === "queued" &&
        row.progressAt === null &&
        now - row.createdAt.getTime() > ORPHAN_AFTER_MS
      ) {
        yield* launchAudit(row.id)
        outcomes.set(row.id, "relaunched")
      }
    }
    return outcomes
  })
