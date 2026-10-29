import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core"
import { organization } from "./auth-schema.ts"

export const orgSetting = pgTable("org_setting", {
  orgId: text("org_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  /** The only source of truth for talking about clients; no row means false. */
  groupByClient: boolean("group_by_client").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})
