import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core"
import { organization } from "./auth-schema.ts"

/*
 * What the consultant sends to clients. `org_branding` is people's work: the audit workflow never
 * writes it. Every table here references `organization` with `on delete cascade`, because the
 * audit tables carry a plain `org_id` and would otherwise outlive an organization.
 */

/** One row per organization; a missing row means the defaults in `server/branding-data.ts`. */
export const orgBranding = pgTable("org_branding", {
  orgId: text("org_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  agencyName: text("agency_name").notNull(),
  /** An id from `ACCENTS` in `apps/web/src/lib/report-accent.ts`. */
  accent: text().notNull(),
  footerText: text("footer_text"),
  showPoweredBy: boolean("show_powered_by").notNull().default(true),
  /** A `Storage` key unique per upload and never overwritten. */
  logoKey: text("logo_key"),
  /** The sniffed type: `image/png`, `image/jpeg` or `image/webp`. */
  logoType: text("logo_type"),
  /** Hex SHA-256 of the stored bytes, computed on the server at upload. */
  logoSha256: text("logo_sha256"),
  updatedBy: text("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
})
