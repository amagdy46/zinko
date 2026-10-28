import { Database } from "@repo/core/Database"
import { aiPolicy } from "@repo/db"
import { createServerFn } from "@tanstack/react-start"
import { Effect, Schema } from "effect"
import { aiPolicyOf } from "./ai-policy-data"
import { requireSession } from "./require-session"
import { Forbidden, isManager, membership, read, mutation } from "./server-fn"

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
    mutation(
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
