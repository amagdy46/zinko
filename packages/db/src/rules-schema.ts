import { integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { audit, run } from "./audit-schema.ts"

/*
 * What the rules in `@repo/rules` concluded. `check_result` and `finding` are derived: the audit
 * workflow deletes and rewrites them, so a retried step writes identical rows. Triage is people's
 * work and lives in `finding_triage`, which the workflow never touches.
 */

const orgId = () => text("org_id").notNull()

/** One rule's verdict on one run, written by `persist-<n>` with the run's hits. */
export const checkResult = pgTable(
  "check_result",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => run.id, { onDelete: "cascade" }),
    orgId: orgId(),
    ruleId: text("rule_id").notNull(),
    rulesVersion: text("rules_version").notNull(),
    /** `pass`, `fail`, `inconclusive` or `not_applicable`. */
    status: text().notNull(),
    message: text().notNull(),
    /** The `EvidenceRef`s the rule cited, into the run's capture and hits. */
    evidence: jsonb().notNull(),
    /*
     * The rule as it read when it judged the run (static per rule and `rules_version`), so `finish`
     * builds findings from stored rows even after a rule is renamed or removed.
     */
    area: text().notNull(),
    severity: text().notNull(),
    title: text().notNull(),
    /** Null on rows written before the rule had a `checkTitle`. */
    checkTitle: text("check_title"),
    /** Who usually fixes it (`OwnerId`); null on rows written before the rule had an owner. */
    owner: text(),
    why: text().notNull(),
    fix: jsonb().notNull(),
    /** The run's `finished_at`, so a retry reproduces the row. */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.ruleId] })],
)

/**
 * A rule that failed (`kind = fail`), or could not be checked (`inconclusive`), on at least one
 * run of the audit; recomputed by `finish`. The title, why and fix are copied from the rule at
 * that moment, so an old audit keeps the wording it was evaluated with.
 */
export const finding = pgTable(
  "finding",
  {
    auditId: uuid("audit_id")
      .notNull()
      .references(() => audit.id, { onDelete: "cascade" }),
    orgId: orgId(),
    ruleId: text("rule_id").notNull(),
    kind: text().notNull(),
    /** Every `RULES_VERSION` the audit's runs were evaluated with for this rule. */
    rulesVersions: text("rules_versions").array().notNull(),
    area: text().notNull(),
    severity: text().notNull(),
    title: text().notNull(),
    /** Null on rows written before the rule had a `checkTitle`. */
    checkTitle: text("check_title"),
    /** From the newest rules version's check results; null on rows from before owners existed. */
    owner: text(),
    why: text().notNull(),
    fix: jsonb().notNull(),
    failingRuns: integer("failing_runs").notNull(),
    inconclusiveRuns: integer("inconclusive_runs").notNull(),
    /** The failing and inconclusive runs, in run order. */
    runIds: uuid("run_ids").array().notNull(),
  },
  (t) => [primaryKey({ columns: [t.auditId, t.ruleId] })],
)

/**
 * A member's call on a finding: `open`, `accepted_risk` or `fixed`. No foreign key to `finding`,
 * so recomputing findings never loses it.
 */
export const findingTriage = pgTable(
  "finding_triage",
  {
    auditId: uuid("audit_id")
      .notNull()
      .references(() => audit.id, { onDelete: "cascade" }),
    orgId: orgId(),
    ruleId: text("rule_id").notNull(),
    status: text().notNull(),
    /** Why the risk was accepted; required for `accepted_risk`, null otherwise. */
    reason: text(),
    updatedBy: text("updated_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    /**
     * Set when `createAudit` copied this row from an earlier audit: the first audit it came from and
     * that audit's creation date. No foreign key on purpose, so deleting the origin keeps both, and
     * independent of `audit.baseline_audit_id`. Cleared by `setTriage`.
     */
    inheritedFromAuditId: uuid("inherited_from_audit_id"),
    inheritedFromAt: timestamp("inherited_from_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.auditId, t.ruleId] })],
)
