import { Database } from "@repo/core/Database"
import { orgSetting } from "@repo/db"
import { createServerFn } from "@tanstack/react-start"
import { Effect, Schema } from "effect"
import { requireSession } from "./require-session"
import { Forbidden, isManager, membership, mutation } from "./server-fn"

export const saveOrgSetting = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ groupByClient: Schema.Boolean })))
  .handler(({ context, data }) =>
    mutation(
      Effect.gen(function* () {
        const { organizationId: orgId, role } = yield* membership(context.session)
        if (!isManager(role))
          return yield* new Forbidden({
            message: "Only organization owners and admins can change this setting.",
          })
        const { db } = yield* Database
        const values = { groupByClient: data.groupByClient, updatedAt: new Date() }
        yield* db
          .insert(orgSetting)
          .values({ orgId, ...values })
          .onConflictDoUpdate({ target: orgSetting.orgId, set: values })
        return { groupByClient: data.groupByClient }
      }),
    ),
  )
