import type { Session } from "@repo/core/Auth"
import { Database } from "@repo/core/Database"
import { member } from "@repo/db"
import { and, eq } from "drizzle-orm"
import { Data, Effect } from "effect"

/** The session's user is not (or no longer) a member of its active organization. */
export class NotAMember extends Data.TaggedError("NotAMember")<{
  readonly userId: string
}> {}

/**
 * The membership behind a session. A session keeps its `activeOrganizationId` after the user is
 * removed from that organization, so scope by this, not by `session.activeOrganizationId` alone.
 * Check the `member` table for the user and the active organization in one query.
 */
export const activeMembership = (session: Session) =>
  Effect.gen(function* () {
    if (session.activeOrganizationId === null)
      return yield* new NotAMember({ userId: session.userId })
    const { db } = yield* Database
    const rows = yield* db
      .select({ role: member.role })
      .from(member)
      .where(
        and(
          eq(member.userId, session.userId),
          eq(member.organizationId, session.activeOrganizationId),
        ),
      )
      .limit(1)
    const found = rows[0]
    if (found === undefined) return yield* new NotAMember({ userId: session.userId })
    return {
      userId: session.userId,
      organizationId: session.activeOrganizationId,
      role: found.role,
    }
  })
