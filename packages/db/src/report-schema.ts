import { boolean, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { organization } from "./auth-schema.ts"
import { audit } from "./audit-schema.ts"

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

/** The consultant's text and disclosure level for one audit; written only by `saveReportEdit`. */
export const reportEdit = pgTable("report_edit", {
  auditId: uuid("audit_id")
    .primaryKey()
    .references(() => audit.id, { onDelete: "cascade" }),
  orgId: text("org_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  /** Replaces the generated summary when set. */
  summary: text(),
  /** `standard` (page aliases) or `detailed` (entered paths and ad-platform IDs). */
  detail: text().notNull().default("standard"),
  updatedBy: text("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
})

/**
 * The consultant's work on one finding of one audit. No foreign key to `finding`, like
 * `finding_triage`: the workflow recomputes findings and must never touch this.
 */
export const reportFindingEdit = pgTable(
  "report_finding_edit",
  {
    auditId: uuid("audit_id")
      .notNull()
      .references(() => audit.id, { onDelete: "cascade" }),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    ruleId: text("rule_id").notNull(),
    note: text(),
    /** Left out of the report's detail and plan; the score and counts still include it. */
    hidden: boolean().notNull().default(false),
    /** Replaces the rule's stored owner hint (an `OwnerId`). */
    owner: text(),
    updatedBy: text("updated_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.auditId, t.ruleId] })],
)
