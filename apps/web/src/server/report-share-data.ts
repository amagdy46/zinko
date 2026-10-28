import { Database } from "@repo/core/Database"
import { reportShare, reportSnapshot, user } from "@repo/db"
import { and, asc, desc, eq } from "drizzle-orm"
import { Effect } from "effect"
import { auditInOrg } from "./audit-data"
import { isManager, isUuid, NotFound } from "./server-fn"

export type ShareStatus = "active" | "expired" | "revoked"

/** A link of the organization. Another organization's id, or a malformed one, is a 404. */
export const shareInOrg = (orgId: string, id: string) =>
  Effect.gen(function* () {
    if (!isUuid(id)) return yield* new NotFound({ message: "Not found" })
    const { db } = yield* Database
    const [found] = yield* db
      .select({ id: reportShare.id })
      .from(reportShare)
      .where(and(eq(reportShare.id, id), eq(reportShare.orgId, orgId)))
      .limit(1)
    if (found === undefined) return yield* new NotFound({ message: "Not found" })
    return found.id
  })

export const statusOf = (
  link: { revokedAt: Date | null; expiresAt: Date | null },
  now: Date,
): ShareStatus => {
  if (link.revokedAt !== null) return "revoked"
  if (link.expiresAt !== null && link.expiresAt <= now) return "expired"
  return "active"
}

/**
 * The audit's published versions with their links, newest first. Never the token or its hash:
 * only what the Report tab's dialog shows.
 */
export const sharesOf = (orgId: string, userId: string, role: string, auditId: string) =>
  Effect.gen(function* () {
    yield* auditInOrg(orgId, auditId)
    const { db } = yield* Database
    const snapshots = yield* db
      .select({
        id: reportSnapshot.id,
        version: reportSnapshot.version,
        publishedAt: reportSnapshot.publishedAt,
        publishedBy: reportSnapshot.publishedBy,
        publishedByName: user.name,
      })
      .from(reportSnapshot)
      .leftJoin(user, eq(user.id, reportSnapshot.publishedBy))
      .where(and(eq(reportSnapshot.auditId, auditId), eq(reportSnapshot.orgId, orgId)))
      .orderBy(desc(reportSnapshot.version))
    const links = yield* db
      .select({
        id: reportShare.id,
        snapshotId: reportShare.snapshotId,
        label: reportShare.label,
        expiresAt: reportShare.expiresAt,
        createdAt: reportShare.createdAt,
        createdByName: user.name,
        revokedAt: reportShare.revokedAt,
        viewCount: reportShare.viewCount,
        lastViewedAt: reportShare.lastViewedAt,
      })
      .from(reportShare)
      .innerJoin(reportSnapshot, eq(reportSnapshot.id, reportShare.snapshotId))
      .leftJoin(user, eq(user.id, reportShare.createdBy))
      .where(and(eq(reportSnapshot.auditId, auditId), eq(reportShare.orgId, orgId)))
      .orderBy(asc(reportShare.createdAt))
    const now = new Date()
    return snapshots.map((s) => ({
      id: s.id,
      version: s.version,
      publishedAt: s.publishedAt.toISOString(),
      publishedByName: s.publishedByName,
      canDelete: isManager(role) || s.publishedBy === userId,
      links: links
        .filter((l) => l.snapshotId === s.id)
        .map((l) => ({
          id: l.id,
          label: l.label,
          status: statusOf(l, now),
          expiresAt: l.expiresAt?.toISOString() ?? null,
          createdAt: l.createdAt.toISOString(),
          createdByName: l.createdByName,
          viewCount: l.viewCount,
          lastViewedAt: l.lastViewedAt?.toISOString() ?? null,
        })),
    }))
  })
