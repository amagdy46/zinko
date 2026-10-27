import {
  boolean,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"
import { organization } from "./auth-schema.ts"

/*
 * The AI switches of an organization. A missing row means the defaults in
 * `apps/web/src/server/ai-policy-data.ts` (`AI_POLICY_DEFAULTS`); the column defaults below only say
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

/*
 * The spend ledger: one row per provider attempt, written before the attempt. It is a ledger, not a
 * derived row, so it has a surrogate id and `defaultNow()`. It is the only thing the hourly cap,
 * the single-flight check and the publication fence read. It holds no content: ids, a hash of the
 * lookup key, timestamps and an outcome. Rows older than 24 hours are deleted inside the next
 * reservation of the same organization (no scheduled job), so an idle organization keeps its last rows.
 */
export const explainUsage = pgTable(
  "explain_usage",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    keyHash: text("key_hash").notNull(),
    generationId: uuid("generation_id").notNull(),
    reservedAt: timestamp("reserved_at", { withTimezone: true }).notNull().defaultNow(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }).notNull(),
    /** Null while in flight; then ok, unreadable, provider_error, timeout or superseded. */
    outcome: text(),
  },
  (t) => [
    index("explain_usage_org_reserved_idx").on(t.orgId, t.reservedAt),
    index("explain_usage_org_key_reserved_idx").on(t.orgId, t.keyHash, t.reservedAt),
  ],
)

/*
 * One cached explanation per distinct input and configuration. The first six key columns are the
 * lookup key (independent of the configuration); provider, model and endpoint say which
 * configuration wrote the text. No foreign key to `llm_credential`: the text outlives the key.
 * The stored digest it was made from is minimised, not free of personal data; no API key is stored.
 */
export const findingExplanation = pgTable(
  "finding_explanation",
  {
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    ruleId: text("rule_id").notNull(),
    rulesVersions: text("rules_versions").notNull(),
    evidenceHash: text("evidence_hash").notNull(),
    promptVersion: text("prompt_version").notNull(),
    policyId: text("policy_id").notNull(),
    provider: text().notNull(),
    model: text().notNull(),
    endpointId: text("endpoint_id").notNull(),
    explanation: jsonb().notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      columns: [
        t.orgId,
        t.ruleId,
        t.rulesVersions,
        t.evidenceHash,
        t.promptVersion,
        t.policyId,
        t.provider,
        t.model,
        t.endpointId,
      ],
    }),
  ],
)
