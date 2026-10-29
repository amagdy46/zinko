import { Database } from "@repo/core/Database"
import { client } from "@repo/db"
import { and, eq } from "drizzle-orm"
import { Effect } from "effect"

/**
 * The organization's hidden default client, created on first use. Write paths only (`createSite`
 * calls it inside its transaction, so a failed create leaves nothing behind); reads treat a
 * missing default as "no sites without a client". The insert and the select are separate
 * statements: under READ COMMITTED a concurrent insert that conflicted has committed by the time
 * the select runs.
 */
export const defaultClientOf = (orgId: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    yield* db
      .insert(client)
      .values({ orgId, name: "Ungrouped", isDefault: true })
      .onConflictDoNothing()
    const [found] = yield* db
      .select({ id: client.id })
      .from(client)
      .where(and(eq(client.orgId, orgId), eq(client.isDefault, true)))
    if (found === undefined) return yield* Effect.die("default client missing after insert")
    return found
  })
