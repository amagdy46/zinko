import { EXPLAIN_ATTEMPT_TIMEOUT_MS, type LlmIdentity } from "@repo/core/llm"
import { Database } from "@repo/core/Database"
import { explainUsage, findingExplanation } from "@repo/db"
import type { Explanation } from "@repo/llm"
import { and, asc, count, desc, eq, gt, isNull, lt, ne, sql } from "drizzle-orm"
import { Effect } from "effect"
import { atomically } from "./server-fn"

/** Provider attempts one organization may start in any sliding hour. Retries and regenerations count. */
export const EXPLAIN_PER_HOUR = 30
/** Attempts per call: the first, and one more when the answer cannot be read. */
export const MAX_ATTEMPTS = 2
const LEASE_MS = EXPLAIN_ATTEMPT_TIMEOUT_MS + 15_000

/** What identifies the input of an explanation, whatever configuration wrote the text. */
export interface LookupKey {
  readonly orgId: string
  readonly ruleId: string
  readonly rulesVersions: string
  readonly evidenceHash: string
  readonly promptVersion: string
  readonly policyId: string
}

export type CachedExplanation = typeof findingExplanation.$inferSelect

/** The ledger's id for a lookup key: sha256 hex of its fields, so the ledger holds no rule or hash text. */
export const keyHashOf = (key: LookupKey) =>
  Effect.promise(async () => {
    const bytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        [key.ruleId, key.rulesVersions, key.evidenceHash, key.promptVersion, key.policyId].join(
          "\n",
        ),
      ),
    )
    return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")
  })

const lookupWhere = (key: LookupKey) =>
  and(
    eq(findingExplanation.orgId, key.orgId),
    eq(findingExplanation.ruleId, key.ruleId),
    eq(findingExplanation.rulesVersions, key.rulesVersions),
    eq(findingExplanation.evidenceHash, key.evidenceHash),
    eq(findingExplanation.promptVersion, key.promptVersion),
    eq(findingExplanation.policyId, key.policyId),
  )

/**
 * The newest cached explanation for the input, from any provider, model or endpoint (ties by
 * provider, model, endpoint). It never asks for the organization's current key, so cached text is
 * still there after the key is removed.
 */
export const findCached = (key: LookupKey) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const [row] = yield* db
      .select()
      .from(findingExplanation)
      .where(lookupWhere(key))
      .orderBy(
        desc(findingExplanation.createdAt),
        asc(findingExplanation.provider),
        asc(findingExplanation.model),
        asc(findingExplanation.endpointId),
      )
      .limit(1)
    return row ?? null
  })

/** The row written under exactly this configuration, or `null`. */
export const cachedFor = (key: LookupKey, identity: LlmIdentity) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const [row] = yield* db
      .select()
      .from(findingExplanation)
      .where(
        and(
          lookupWhere(key),
          eq(findingExplanation.provider, identity.provider),
          eq(findingExplanation.model, identity.model),
          eq(findingExplanation.endpointId, identity.endpointId),
        ),
      )
      .limit(1)
    return row ?? null
  })

/** True while another generation of the same input holds a live lease. */
export const generationInFlight = (orgId: string, keyHash: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const [row] = yield* db
      .select({ id: explainUsage.id })
      .from(explainUsage)
      .where(
        and(
          eq(explainUsage.orgId, orgId),
          eq(explainUsage.keyHash, keyHash),
          isNull(explainUsage.outcome),
          gt(explainUsage.leaseUntil, sql`clock_timestamp()`),
        ),
      )
      .limit(1)
    return row !== undefined
  })

/** Serialises one organization's reservations and publications; released with the transaction. */
const lockOrganization = (orgId: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    yield* db.execute(sql`select pg_advisory_xact_lock(hashtext(${orgId}))`)
  })

export interface ReserveInput {
  readonly key: LookupKey
  readonly keyHash: string
  readonly userId: string
  readonly generationId: string
  readonly identity: LlmIdentity
  /**
   * Regenerate only: when this configuration's row was last written before the request began
   * (`null` for none). A newer row, written while the request waited, is the answer.
   */
  readonly regenerateSince: { readonly at: Date | null } | null
}

export type Reservation =
  | { readonly tag: "cached"; readonly row: CachedExplanation }
  | { readonly tag: "in-flight" }
  | { readonly tag: "limit" }
  | { readonly tag: "reserved"; readonly usageId: string }

/**
 * One short transaction before a provider attempt, as separate statements under a per-organization
 * advisory lock: drop the organization's ledger rows older than 24 hours (opportunistic cleanup,
 * there is no job), re-check the cache (a completion between the caller's miss and this lock is
 * the answer, no spend), refuse while another generation of the input is live, refuse at the
 * hourly cap, insert the ledger row. The lock is gone before the provider is called.
 */
export const reserve = (input: ReserveInput) =>
  atomically(
    Effect.gen(function* () {
      const { db } = yield* Database
      const { key, regenerateSince } = input
      yield* lockOrganization(key.orgId)
      yield* db
        .delete(explainUsage)
        .where(
          and(
            eq(explainUsage.orgId, key.orgId),
            lt(explainUsage.reservedAt, sql`clock_timestamp() - interval '24 hours'`),
          ),
        )
      const answer =
        regenerateSince === null ? yield* findCached(key) : yield* cachedFor(key, input.identity)
      if (
        answer !== null &&
        (regenerateSince === null ||
          regenerateSince.at === null ||
          answer.createdAt > regenerateSince.at)
      )
        return { tag: "cached", row: answer } as const
      const [other] = yield* db
        .select({ id: explainUsage.id })
        .from(explainUsage)
        .where(
          and(
            eq(explainUsage.orgId, key.orgId),
            eq(explainUsage.keyHash, input.keyHash),
            isNull(explainUsage.outcome),
            gt(explainUsage.leaseUntil, sql`clock_timestamp()`),
            ne(explainUsage.generationId, input.generationId),
          ),
        )
        .limit(1)
      if (other !== undefined) return { tag: "in-flight" } as const
      const [recent] = yield* db
        .select({ n: count() })
        .from(explainUsage)
        .where(
          and(
            eq(explainUsage.orgId, key.orgId),
            gt(explainUsage.reservedAt, sql`clock_timestamp() - interval '1 hour'`),
          ),
        )
      if ((recent?.n ?? 0) >= EXPLAIN_PER_HOUR) return { tag: "limit" } as const
      const [created] = yield* db
        .insert(explainUsage)
        .values({
          orgId: key.orgId,
          userId: input.userId,
          keyHash: input.keyHash,
          generationId: input.generationId,
          reservedAt: sql`clock_timestamp()`,
          leaseUntil: sql`clock_timestamp() + ${LEASE_MS} * interval '1 millisecond'`,
        })
        .returning({ id: explainUsage.id })
      if (created === undefined) return yield* Effect.die("the ledger insert returned no row")
      return { tag: "reserved", usageId: created.id } as const
    }),
  )

/** Records how an attempt ended when it did not produce a publishable answer. */
export const settle = (usageId: string, outcome: "unreadable" | "provider_error" | "timeout") =>
  Effect.gen(function* () {
    const { db } = yield* Database
    yield* db
      .update(explainUsage)
      .set({ outcome })
      .where(and(eq(explainUsage.id, usageId), isNull(explainUsage.outcome)))
  })

export interface PublishInput {
  readonly key: LookupKey
  readonly keyHash: string
  readonly usageId: string
  readonly identity: LlmIdentity
  readonly explanation: Explanation
  readonly userId: string
}

export type Publication =
  | { readonly tag: "published"; readonly row: CachedExplanation }
  | { readonly tag: "superseded"; readonly row: CachedExplanation | null }

/**
 * Fenced publication, in a second transaction under the same lock: the answer is written only if
 * this attempt still owns a live lease and no later generation of the same input has reserved.
 * Otherwise it is discarded, the attempt is marked `superseded`, and the caller gets the newest
 * cached row (or none). So a response that arrives after its lease expired or after a replacement
 * cannot overwrite a newer result.
 */
export const publish = (input: PublishInput) =>
  atomically(
    Effect.gen(function* () {
      const { db } = yield* Database
      const { key } = input
      yield* lockOrganization(key.orgId)
      const [own] = yield* db
        .select({
          live: sql<boolean>`${explainUsage.outcome} is null and ${explainUsage.leaseUntil} > clock_timestamp()`,
          reservedAt: explainUsage.reservedAt,
          generationId: explainUsage.generationId,
        })
        .from(explainUsage)
        .where(eq(explainUsage.id, input.usageId))
        .limit(1)
      const [replacement] =
        own === undefined
          ? []
          : yield* db
              .select({ id: explainUsage.id })
              .from(explainUsage)
              .where(
                and(
                  eq(explainUsage.orgId, key.orgId),
                  eq(explainUsage.keyHash, input.keyHash),
                  ne(explainUsage.generationId, own.generationId),
                  gt(explainUsage.reservedAt, own.reservedAt),
                ),
              )
              .limit(1)
      if (own === undefined || !own.live || replacement !== undefined) {
        yield* db
          .update(explainUsage)
          .set({ outcome: "superseded" })
          .where(and(eq(explainUsage.id, input.usageId), isNull(explainUsage.outcome)))
        return { tag: "superseded", row: yield* findCached(key) } as const
      }
      const values = {
        ...key,
        provider: input.identity.provider,
        model: input.identity.model,
        endpointId: input.identity.endpointId,
        explanation: input.explanation,
        createdBy: input.userId,
        createdAt: sql`clock_timestamp()`,
      }
      const [row] = yield* db
        .insert(findingExplanation)
        .values(values)
        .onConflictDoUpdate({
          target: [
            findingExplanation.orgId,
            findingExplanation.ruleId,
            findingExplanation.rulesVersions,
            findingExplanation.evidenceHash,
            findingExplanation.promptVersion,
            findingExplanation.policyId,
            findingExplanation.provider,
            findingExplanation.model,
            findingExplanation.endpointId,
          ],
          set: {
            explanation: values.explanation,
            createdBy: values.createdBy,
            createdAt: values.createdAt,
          },
        })
        .returning()
      if (row === undefined) return yield* Effect.die("the cache upsert returned no row")
      yield* db
        .update(explainUsage)
        .set({ outcome: "ok" })
        .where(eq(explainUsage.id, input.usageId))
      return { tag: "published", row } as const
    }),
  )
