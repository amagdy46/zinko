import { Database } from "@repo/core/Database"
import { aiPolicy } from "@repo/db"
import { createServerFn } from "@tanstack/react-start"
import { eq } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { requireSession } from "./require-session"
import { Forbidden, isManager, membership, read, respond } from "./server-fn"

/** What an organization without an `ai_policy` row gets: nothing leaves for a provider. */
export const AI_POLICY_DEFAULTS = { explanationsEnabled: false, includePagePaths: false }

/** The organization's AI switches; the defaults when it never saved any. */
const aiPolicyOf = (orgId: string) =>
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

const SaveInput = Schema.Struct({
  explanationsEnabled: Schema.Boolean,
  includePagePaths: Schema.Boolean,
})

/** The policy and whether the caller may change it. Any member may read it. */
export const getAiPolicy = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .handler(({ context }) =>
    read(
      Effect.gen(function* () {
        const { organizationId, role } = yield* membership(context.session)
        return { ...(yield* aiPolicyOf(organizationId)), canManage: isManager(role) }
      }),
    ),
  )

export const saveAiPolicy = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(SaveInput))
  .handler(({ context, data }) =>
    respond(
      Effect.gen(function* () {
        const { organizationId, role, userId } = yield* membership(context.session)
        if (!isManager(role))
          return yield* new Forbidden({
            message: "Only organization owners and admins can change the AI policy.",
          })
        const { db } = yield* Database
        const values = {
          explanationsEnabled: data.explanationsEnabled,
          includePagePaths: data.includePagePaths,
          updatedBy: userId,
          updatedAt: new Date(),
        }
        yield* db
          .insert(aiPolicy)
          .values({ orgId: organizationId, ...values })
          .onConflictDoUpdate({ target: aiPolicy.orgId, set: values })
        return data
      }),
    ),
  )
