import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core"
import { organization } from "./auth-schema.ts"

/*
 * The AI switches of an organization. A missing row means the defaults in
 * `apps/web/src/server/ai-policy.ts` (`AI_POLICY_DEFAULTS`); the column defaults below only say
 * the same for rows written without a value.
 */
export const aiPolicy = pgTable("ai_policy", {
  orgId: text("org_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  explanationsEnabled: boolean("explanations_enabled").notNull().default(false),
  includePagePaths: boolean("include_page_paths").notNull().default(false),
  updatedBy: text("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
})
