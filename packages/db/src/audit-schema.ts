import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core"

/*
 * Every table carries org_id and is reached through its owning audit, checked against the
 * organization. Foreign keys from audits upward are `restrict`: evidence is archived, never
 * deleted by accident.
 *
 * A hit's identity across re-runs (for the M6 compare) is page URL + scenario + viewport +
 * vendor + destination + event + its order among equal hits. M3 counts purchases by
 * transaction ID and label, not by hit.
 */

const orgId = () => text("org_id").notNull()
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow()

export const client = pgTable(
  "client",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: orgId(),
    createdAt: createdAt(),
    name: text().notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [index("client_org_archived_idx").on(t.orgId, t.archivedAt)],
)

export const site = pgTable(
  "site",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: orgId(),
    createdAt: createdAt(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "restrict" }),
    name: text().notNull(),
    origin: text().notNull(),
    host: text().notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [index("site_org_client_idx").on(t.orgId, t.clientId)],
)

export const audit = pgTable(
  "audit",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: orgId(),
    createdAt: createdAt(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => site.id, { onDelete: "restrict" }),
    createdBy: text("created_by").notNull(),
    config: jsonb().notNull(),
    status: text().notNull(),
    error: text(),
    workflowId: text("workflow_id"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("audit_org_site_created_idx").on(t.orgId, t.siteId, t.createdAt.desc())],
)

export const run = pgTable(
  "run",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: orgId(),
    createdAt: createdAt(),
    auditId: uuid("audit_id")
      .notNull()
      .references(() => audit.id, { onDelete: "cascade" }),
    failure: text(),
    ordinal: integer().notNull(),
    pageUrl: text("page_url").notNull(),
    scenario: text().notNull(),
    viewport: text().notNull(),
    /** Walks from the page URL (the start URL) through the key pages in one browser context. */
    journey: boolean().notNull().default(false),
    status: text().notNull(),
    engine: jsonb(),
    decoderVersion: text("decoder_version"),
    consent: jsonb(),
    documents: jsonb(),
    cookies: jsonb(),
    errors: jsonb(),
    complete: boolean(),
    truncated: boolean(),
    screenshotKey: text("screenshot_key"),
    captureKey: text("capture_key"),
    hitCount: integer("hit_count").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [unique("run_audit_ordinal_unique").on(t.auditId, t.ordinal)],
)

export const hit = pgTable(
  "hit",
  {
    orgId: orgId(),
    createdAt: createdAt(),
    runId: uuid("run_id")
      .notNull()
      .references(() => run.id, { onDelete: "cascade" }),
    requestId: text("request_id").notNull(),
    batchIndex: integer("batch_index").notNull(),
    documentId: text("document_id").notNull(),
    at: integer().notNull(),
    vendor: text().notNull(),
    destinationId: text("destination_id").notNull(),
    event: text().notNull(),
    params: jsonb().notNull(),
    ids: jsonb().notNull(),
    consent: jsonb().notNull(),
    host: text().notNull(),
    url: text().notNull(),
    blocked: boolean().notNull(),
    status: integer(),
    /**
     * Sent at or after the consent action (`startedAt >= consent.actionAt`). Always false when there
     * was no action (`none`, `gpc`, `not-found`), so `false` does not mean "before consent": rules
     * must branch on the run's `consent.outcome` first.
     */
    afterConsentAction: boolean("after_consent_action").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.requestId, t.batchIndex] }),
    index("hit_run_at_idx").on(t.runId, t.at, t.requestId, t.batchIndex),
    index("hit_run_vendor_event_idx").on(t.runId, t.vendor, t.event),
  ],
)

export const datalayerPush = pgTable(
  "datalayer_push",
  {
    orgId: orgId(),
    createdAt: createdAt(),
    runId: uuid("run_id")
      .notNull()
      .references(() => run.id, { onDelete: "cascade" }),
    seq: integer().notNull(),
    documentId: text("document_id").notNull(),
    at: integer().notNull(),
    value: jsonb().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.seq] }),
    index("datalayer_push_run_at_idx").on(t.runId, t.at, t.seq),
  ],
)

export type Client = typeof client.$inferSelect
export type Site = typeof site.$inferSelect
export type Audit = typeof audit.$inferSelect
export type Run = typeof run.$inferSelect
export type Hit = typeof hit.$inferSelect
export type DatalayerPush = typeof datalayerPush.$inferSelect
