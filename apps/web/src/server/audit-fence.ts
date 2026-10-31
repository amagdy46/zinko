import { Database } from "@repo/core/Database"
import { audit } from "@repo/db"
import { and, eq, inArray, sql } from "drizzle-orm"
import { Effect } from "effect"

export const ACTIVE_STATUSES = ["queued", "running"] as const

/**
 * The terminal result of a workflow step whose audit was settled while the workflow still ran.
 * It is a normal step result, never a thrown error, so Cloudflare does not retry it.
 */
export interface Fenced {
  readonly fenced: true
}
export const FENCED: Fenced = { fenced: true }
export const isFenced = (value: unknown): value is Fenced =>
  typeof value === "object" && value !== null && "fenced" in value && value.fenced === true

/**
 * The audit row is the fence. This statement is the heartbeat and the check in one: it records
 * `progress_at` on an audit that is still queued or running, takes the audit row lock (which
 * `settleAudit` also needs, so the two serialise) and returns whether the audit was active.
 */
const touch = (auditId: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const rows = yield* db
      .update(audit)
      .set({ progressAt: sql`now()` })
      .where(and(eq(audit.id, auditId), inArray(audit.status, [...ACTIVE_STATUSES])))
      .returning({ id: audit.id })
    return rows.length > 0
  })

/**
 * Runs `body` in a transaction whose first statement is the fence. A settled audit yields
 * `Fenced` and nothing is written. Lock order inside: audit, then runs, hits, pushes, check
 * results, findings; workflow transactions never lock a client or a site.
 */
export const fenced = <A, E, R>(auditId: string, body: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    return yield* db.$client.withTransaction(
      Effect.gen(function* () {
        if (!(yield* touch(auditId))) return FENCED
        return yield* body
      }),
    )
  })

/**
 * The start of every actual attempt of a step: a heartbeat in its own committed transaction, so a
 * later failure of the attempt cannot roll it back. A settled audit stops the attempt at once.
 */
export const heartbeat = <A, E, R>(auditId: string, body: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    if (!(yield* touch(auditId))) return FENCED
    return yield* body
  })
