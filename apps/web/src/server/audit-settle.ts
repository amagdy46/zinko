import { type AuditEvent, AuditProgress, Jobs } from "@repo/core"
import { Database } from "@repo/core/Database"
import { audit, checkResult, client, finding, run, site } from "@repo/db"
import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { Effect } from "effect"
import { findingsFrom } from "../lib/findings-from"
import { ACTIVE_STATUSES } from "./audit-fence"
import { atomically } from "./server-fn"

/** Progress is a courtesy to open tabs, which refetch anyway: it never fails or stalls a step. */
export const publish = (auditId: string, event: AuditEvent) =>
  Effect.gen(function* () {
    const progress = yield* AuditProgress
    yield* progress.publish(auditId, event)
  }).pipe(
    Effect.timeout("5 seconds"),
    Effect.ignoreCause({ log: "Warn", message: "Audit progress not published" }),
  )

/** `complete` when every run is; `failed` when no run has a capture; `partial` otherwise. */
const auditStatus = (runs: ReadonlyArray<{ status: string; captureKey: string | null }>) => {
  if (runs.every((r) => r.status === "complete")) return "complete"
  if (runs.every((r) => r.captureKey === null)) return "failed"
  return "partial"
}

/**
 * Settles the audit's status and recomputes its findings from its runs' check results. Runs inside
 * a transaction that already holds the audit row lock (the workflow's fence, or `settleAudit`): a
 * retry replaces the findings with the same rows. Triage is never touched.
 */
export const closeAudit = (auditId: string, error: string | null = null) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const runs = yield* db
      .select({ status: run.status, captureKey: run.captureKey })
      .from(run)
      .where(eq(run.auditId, auditId))
    const status = auditStatus(runs)
    const checks = yield* db
      .select({
        runId: checkResult.runId,
        orgId: checkResult.orgId,
        ruleId: checkResult.ruleId,
        rulesVersion: checkResult.rulesVersion,
        status: checkResult.status,
        area: checkResult.area,
        severity: checkResult.severity,
        title: checkResult.title,
        checkTitle: checkResult.checkTitle,
        owner: checkResult.owner,
        why: checkResult.why,
        fix: checkResult.fix,
      })
      .from(checkResult)
      .innerJoin(run, eq(run.id, checkResult.runId))
      .where(eq(run.auditId, auditId))
      .orderBy(asc(run.ordinal), asc(checkResult.ruleId))
    const findings = findingsFrom(auditId, checks)
    yield* db.delete(finding).where(eq(finding.auditId, auditId))
    if (findings.length > 0) yield* db.insert(finding).values(findings)
    yield* db
      .update(audit)
      .set({
        status,
        finishedAt: sql`coalesce(${audit.finishedAt}, now())`,
        ...(error === null ? {} : { error }),
      })
      .where(eq(audit.id, auditId))
    return status
  })

/** What the caller saw of the audit when it decided to settle it. */
export interface Observed {
  readonly workflowId: string | null
  readonly progressAt: Date | null
  /** The workflow's own error text when its status was read, else null. */
  readonly error: string | null
}

const STOPPED = "The audit stopped before it finished."
const INTERRUPTED = {
  code: "Interrupted",
  message: "The audit stopped before this run finished",
}

/**
 * The one way to close an audit whose workflow ended or went silent. One short transaction in the
 * AGENTS.md lock order (client, site, audit, then finer), then a revalidation: the audit is the
 * organization's, still queued or running, and `workflow_id` and `progress_at` are what the caller
 * saw (otherwise nothing changes). Unfinished runs are closed by what they hold: a run with a
 * stored capture keeps it and its capture time, so a retry can still use it. Because every
 * workflow transaction starts by locking this row, a settled audit cannot change again: a workflow
 * that is still alive ends fenced. `Jobs` is called after the commit, outside the transaction.
 * Returns the new status, or `null` when nothing changed.
 */
export const settleAudit = (orgId: string, auditId: string, observed: Observed) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const status = yield* atomically(
      Effect.gen(function* () {
        const [owner] = yield* db
          .select({ siteId: audit.siteId, clientId: site.clientId })
          .from(audit)
          .innerJoin(site, eq(site.id, audit.siteId))
          .where(and(eq(audit.id, auditId), eq(audit.orgId, orgId)))
          .limit(1)
        if (owner === undefined) return null
        yield* db
          .select({ id: client.id })
          .from(client)
          .where(eq(client.id, owner.clientId))
          .for("key share")
        yield* db
          .select({ id: site.id })
          .from(site)
          .where(eq(site.id, owner.siteId))
          .for("key share")
        const [locked] = yield* db
          .select({
            status: audit.status,
            workflowId: audit.workflowId,
            progressAt: audit.progressAt,
          })
          .from(audit)
          .where(and(eq(audit.id, auditId), eq(audit.orgId, orgId)))
          .limit(1)
          .for("update")
        if (
          locked === undefined ||
          !(ACTIVE_STATUSES as ReadonlyArray<string>).includes(locked.status) ||
          locked.workflowId !== observed.workflowId ||
          locked.progressAt?.getTime() !== observed.progressAt?.getTime()
        )
          return null
        const interrupted = yield* db
          .update(run)
          .set({
            status: "failed",
            failure: INTERRUPTED.code,
            errors: [INTERRUPTED],
            hitCount: 0,
            finishedAt: sql`coalesce(${run.finishedAt}, now())`,
          })
          .where(
            and(eq(run.auditId, auditId), inArray(run.status, ["pending", "running", "queued"])),
          )
          .returning({ id: run.id })
        let error = observed.error?.slice(0, 500) ?? null
        if (error === null && interrupted.length > 0) error = STOPPED
        return yield* closeAudit(auditId, error)
      }),
    )
    if (status === null) return null
    yield* publish(auditId, { type: "audit", status })
    const jobs = yield* Jobs
    yield* jobs
      .terminate("audit", auditId)
      .pipe(Effect.ignoreCause({ log: "Debug", message: "Audit workflow not terminated" }))
    return status
  })
