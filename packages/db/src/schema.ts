import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

/** Example table. `orgId` is null until you scope notes to an organization. */
export const note = pgTable("note", {
  id: uuid().primaryKey().defaultRandom(),
  orgId: text("org_id"),
  title: text().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export type Note = typeof note.$inferSelect
