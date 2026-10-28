import { Storage } from "@repo/core"
import { Database } from "@repo/core/Database"
import { audit, orgBranding, organization, reportFileCleanup, reportSnapshot, user } from "@repo/db"
import { and, desc, eq, sql } from "drizzle-orm"
import { Data, Effect, Option } from "effect"
import { REPORT_MODEL_VERSION } from "@/lib/report-model"
import { auditInOrg } from "./audit-data"
import { sha256Hex } from "./branding-data"
import { buildReport, readStamp } from "./report-data"
import { atomically, Forbidden, Invalid, isManager, isUuid, NotFound } from "./server-fn"

/** The build and the lock disagreed about the inputs, or the logo moved: start again from the read. */
class Changed extends Data.TaggedError("Changed")<{ readonly reason: "stamp" | "logo" }> {}

const MAX_ATTEMPTS = 3

const deleteQuietly = (key: string | null) =>
  key === null
    ? Effect.void
    : Effect.gen(function* () {
        const storage = yield* Storage
        yield* storage.delete(key)
      }).pipe(
        Effect.catch((error) => Effect.logWarning("report object not deleted", error.operation)),
      )

/**
 * Freezes the report as it reads now. Build outside any lock; then lock the audit row, compare the
 * input stamp (a note saved meanwhile sends us back to the read, at most three times), reuse the
 * latest snapshot when it is identical, otherwise take the next version from the audit's counter,
 * copy the logo (digest verified) and insert, all in one transaction.
 */
export const publishReportData = (orgId: string, userId: string, auditId: string) => {
  const attempt = Effect.gen(function* () {
    const built = yield* buildReport(orgId, auditId)
    if (!built.available)
      return yield* new Invalid({ message: "There is no report to publish for this audit yet." })
    if (built.transientEvidenceFailures.length > 0)
      return yield* new Invalid({ message: "Some evidence could not be read; try again" })
    const storage = yield* Storage
    let copied: string | null = null
    return yield* atomically(
      Effect.gen(function* () {
        const { db } = yield* Database
        yield* db
          .select({ id: audit.id })
          .from(audit)
          .where(and(eq(audit.id, auditId), eq(audit.orgId, orgId)))
          .for("update")
        const stamp = yield* readStamp(orgId, auditId)
        if (JSON.stringify(stamp) !== JSON.stringify(built.stamp))
          return yield* new Changed({ reason: "stamp" })
        const [latest] = yield* db
          .select({
            id: reportSnapshot.id,
            version: reportSnapshot.version,
            publicationHash: reportSnapshot.publicationHash,
          })
          .from(reportSnapshot)
          .where(and(eq(reportSnapshot.auditId, auditId), eq(reportSnapshot.orgId, orgId)))
          .orderBy(desc(reportSnapshot.version))
          .limit(1)
        if (latest !== undefined && latest.publicationHash === built.publicationHash)
          return { snapshotId: latest.id, version: latest.version, reused: true }
        const [counter] = yield* db
          .update(audit)
          .set({ reportVersionSeq: sql`${audit.reportVersionSeq} + 1` })
          .where(eq(audit.id, auditId))
          .returning({ version: audit.reportVersionSeq })
        if (counter === undefined) return yield* new NotFound({ message: "Not found" })
        const snapshotId = crypto.randomUUID()
        let logoKey: string | null = null
        if (built.logo !== null) {
          const source = yield* storage.get(built.logo.key).pipe(Effect.orDie)
          if (Option.isNone(source)) return yield* new Changed({ reason: "logo" })
          const bytes = new Uint8Array(
            yield* Effect.promise(() => new Response(source.value.body).arrayBuffer()),
          )
          if ((yield* sha256Hex(bytes)) !== built.logo.sha256)
            return yield* new Changed({ reason: "logo" })
          logoKey = `reports/${orgId}/${snapshotId}/logo`
          copied = logoKey
          yield* storage
            .put(
              logoKey,
              bytes,
              built.logo.type === null ? undefined : { contentType: built.logo.type },
            )
            .pipe(Effect.orDie)
        }
        yield* db.insert(reportSnapshot).values({
          id: snapshotId,
          orgId,
          auditId,
          version: counter.version,
          modelVersion: REPORT_MODEL_VERSION,
          model: built.model,
          publicationHash: built.publicationHash,
          logoKey,
          logoType: logoKey === null ? null : (built.logo?.type ?? null),
          logoSha256: logoKey === null ? null : (built.logo?.sha256 ?? null),
          publishedBy: userId,
        })
        return { snapshotId, version: counter.version, reused: false }
      }),
    ).pipe(
      // A copy whose row did not commit is unreachable; remove it, best effort.
      Effect.onError(() => deleteQuietly(copied)),
    )
  })
  return attempt.pipe(
    Effect.retry({ times: MAX_ATTEMPTS - 1, while: (error) => error instanceof Changed }),
    Effect.catchTag("Changed", () =>
      Effect.fail(
        new Invalid({ message: "The report changed while it was being published. Try again." }),
      ),
    ),
  )
}

/** A snapshot of the organization, without its model. Another organization's id is a 404. */
export const snapshotInOrg = (orgId: string, id: string) =>
  Effect.gen(function* () {
    if (!isUuid(id)) return yield* new NotFound({ message: "Not found" })
    const { db } = yield* Database
    const [found] = yield* db
      .select({
        id: reportSnapshot.id,
        auditId: reportSnapshot.auditId,
        version: reportSnapshot.version,
        logoKey: reportSnapshot.logoKey,
        publishedBy: reportSnapshot.publishedBy,
      })
      .from(reportSnapshot)
      .where(and(eq(reportSnapshot.id, id), eq(reportSnapshot.orgId, orgId)))
      .limit(1)
    if (found === undefined) return yield* new NotFound({ message: "Not found" })
    return found
  })

/** Deletes a published version (its links go with the row) and then its logo copy. */
export const deleteSnapshotData = (
  orgId: string,
  userId: string,
  role: string,
  snapshotId: string,
) =>
  Effect.gen(function* () {
    const found = yield* snapshotInOrg(orgId, snapshotId)
    if (!isManager(role) && found.publishedBy !== userId)
      return yield* new Forbidden({
        message: "Only owners, admins and the member who published a version can delete it.",
      })
    const { db } = yield* Database
    yield* db
      .delete(reportSnapshot)
      .where(and(eq(reportSnapshot.id, found.id), eq(reportSnapshot.orgId, orgId)))
    yield* deleteQuietly(found.logoKey)
    return yield* versionsOf(orgId, found.auditId)
  })

/** The audit's published versions, newest first, with who published them and whether this member may delete each. */
export const versionsOf = (orgId: string, auditId: string) =>
  Effect.gen(function* () {
    yield* auditInOrg(orgId, auditId)
    const { db } = yield* Database
    const rows = yield* db
      .select({
        id: reportSnapshot.id,
        version: reportSnapshot.version,
        publishedAt: reportSnapshot.publishedAt,
        publishedBy: reportSnapshot.publishedBy,
        publishedByName: user.name,
        publicationHash: reportSnapshot.publicationHash,
      })
      .from(reportSnapshot)
      .leftJoin(user, eq(user.id, reportSnapshot.publishedBy))
      .where(and(eq(reportSnapshot.auditId, auditId), eq(reportSnapshot.orgId, orgId)))
      .orderBy(desc(reportSnapshot.version))
    return rows
  })

/**
 * Before an organization is deleted: remember the keys of its logo objects in the outbox. It only
 * adds (a repeat is a no-op) and never clears: a second, concurrent deletion collects after the first
 * has cascaded the rows away and must not erase what the first recorded. Rows of an abandoned
 * attempt are inert until the organization is gone, and deleting an object twice is harmless. Throws
 * (so the deletion does not happen) if it cannot.
 */
export const collectOrganizationFiles = (orgId: string) =>
  atomically(
    Effect.gen(function* () {
      const { db } = yield* Database
      const branding = yield* db
        .select({ key: orgBranding.logoKey })
        .from(orgBranding)
        .where(eq(orgBranding.orgId, orgId))
      const snapshots = yield* db
        .select({ key: reportSnapshot.logoKey })
        .from(reportSnapshot)
        .where(eq(reportSnapshot.orgId, orgId))
      const keys = [...new Set([...branding, ...snapshots].flatMap((row) => row.key ?? []))]
      if (keys.length > 0)
        yield* db
          .insert(reportFileCleanup)
          .values(keys.map((key) => ({ orgId, key })))
          .onConflictDoNothing()
    }),
  )

/**
 * After an organization is deleted: delete the objects in the outbox of every organization that no
 * longer exists, removing each outbox row only once its object is gone (a failure leaves it for
 * the next deletion).
 */
export const purgeOrganizationFiles = Effect.gen(function* () {
  const { db } = yield* Database
  const storage = yield* Storage
  const rows = yield* db
    .select()
    .from(reportFileCleanup)
    .where(
      sql`not exists (select 1 from ${organization} where ${organization.id} = ${reportFileCleanup.orgId})`,
    )
  yield* Effect.forEach(rows, (row) =>
    storage.delete(row.key).pipe(
      Effect.flatMap(() =>
        db
          .delete(reportFileCleanup)
          .where(and(eq(reportFileCleanup.orgId, row.orgId), eq(reportFileCleanup.key, row.key))),
      ),
      Effect.catchTag("StorageError", (error) =>
        Effect.logWarning("organization file not deleted", error.operation),
      ),
    ),
  )
})
