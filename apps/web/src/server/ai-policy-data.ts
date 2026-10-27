import { Database } from "@repo/core/Database"
import { aiPolicy } from "@repo/db"
import { eq } from "drizzle-orm"
import { Effect } from "effect"

/*
 * Kept out of `ai-policy.ts` (which routes import for its server functions): an exported value in
 * that file would be bundled into the client build with the database code it uses.
 */

/** What an organization without an `ai_policy` row gets: nothing leaves for a provider. */
export const AI_POLICY_DEFAULTS = { explanationsEnabled: false, includePagePaths: false }

/** The organization's AI switches; the defaults when it never saved any. */
export const aiPolicyOf = (orgId: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const [row] = yield* db
      .select({
        explanationsEnabled: aiPolicy.explanationsEnabled,
        includePagePaths: aiPolicy.includePagePaths,
      })
      .from(aiPolicy)
      .where(eq(aiPolicy.orgId, orgId))
      .limit(1)
    return row ?? AI_POLICY_DEFAULTS
  })
