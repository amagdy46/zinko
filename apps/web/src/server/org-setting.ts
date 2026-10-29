import { Database } from "@repo/core/Database"
import { orgSetting } from "@repo/db"
import { createServerFn } from "@tanstack/react-start"
import { Effect, Schema } from "effect"
import { requireSession } from "./require-session"
import { groupByClientOf } from "./org-setting-data"
import { Forbidden, isManager, membership, mutation, read } from "./server-fn"

/** The organization's setting and whether the caller may change it. Any member may read it. */
export const getOrgSetting = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .handler(({ context }) =>
    read(
      Effect.gen(function* () {
        const { organizationId: orgId, role } = yield* membership(context.session)
        return { groupByClient: yield* groupByClientOf(orgId), canManage: isManager(role) }
      }),
    ),
  )

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
