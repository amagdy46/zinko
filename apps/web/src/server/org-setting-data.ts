import { Database } from "@repo/core/Database"
import { orgSetting } from "@repo/db"
import { eq } from "drizzle-orm"
import { Effect } from "effect"

/** Whether the organization talks about clients: its `org_setting` row, else false. */
export const groupByClientOf = (orgId: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const [row] = yield* db
      .select({ groupByClient: orgSetting.groupByClient })
      .from(orgSetting)
      .where(eq(orgSetting.orgId, orgId))
    return row?.groupByClient ?? false
  })
