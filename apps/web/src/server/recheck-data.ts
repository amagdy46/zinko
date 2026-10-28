import { Database } from "@repo/core/Database"
import { audit, checkResult, run } from "@repo/db"
import { AuditConfig } from "@repo/core"
import { cellId, cellKeyOf } from "@/lib/compare"
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"
import { storedCells } from "./cell-key"

/** How many of a re-check's runs still fail the rule, and how many gave a verdict at all. */
export const verdictOf = (orgId: string, auditId: string, ruleId: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const [row] = yield* db
      .select({
        failing: sql<number>`count(*) filter (where ${checkResult.status} = 'fail')`.mapWith(
          Number,
        ),
        determinate:
          sql<number>`count(*) filter (where ${checkResult.status} in ('pass', 'fail', 'not_applicable') and ${run.status} = 'complete')`.mapWith(
            Number,
          ),
      })
      .from(checkResult)
      .innerJoin(run, eq(run.id, checkResult.runId))
      .where(
        and(
          eq(run.auditId, auditId),
          eq(run.role, "target"),
          eq(run.orgId, orgId),
          eq(checkResult.orgId, orgId),
          eq(checkResult.ruleId, ruleId),
        ),
      )
    return { failing: row?.failing ?? 0, determinate: row?.determinate ?? 0 }
  })

/**
 * The newest finished re-check of a rule made after this full audit whose cells all failed the rule
 * in it, so a re-check shows on the audit it checked and on any later audit that failed on the same
 * pages and scenarios.
 */
export const latestRecheckOf = (orgId: string, auditId: string, ruleId: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const [self] = yield* db
      .select({
        siteId: audit.siteId,
        createdAt: audit.createdAt,
        kind: audit.kind,
        config: audit.config,
      })
      .from(audit)
      .where(and(eq(audit.id, auditId), eq(audit.orgId, orgId)))
      .limit(1)
    if (self === undefined || self.kind !== "full") return Option.none()
    const config = yield* Schema.decodeUnknownEffect(AuditConfig)(self.config).pipe(Effect.orDie)
    const failed = yield* db
      .select({
        pageUrl: run.pageUrl,
        scenario: run.scenario,
        viewport: run.viewport,
        journey: run.journey,
        followHost: run.followHost,
      })
      .from(checkResult)
      .innerJoin(run, eq(run.id, checkResult.runId))
      .where(
        and(
          eq(run.auditId, auditId),
          eq(run.role, "target"),
          eq(run.orgId, orgId),
          eq(checkResult.orgId, orgId),
          eq(checkResult.ruleId, ruleId),
          eq(checkResult.status, "fail"),
        ),
      )
    const failedCells = new Set(failed.map((r) => cellId(cellKeyOf(r, config))))
    const candidates = yield* db
      .select({ id: audit.id, createdAt: audit.createdAt, cells: audit.narrowCells })
      .from(audit)
      .where(
        and(
          eq(audit.siteId, self.siteId),
          eq(audit.orgId, orgId),
          eq(audit.kind, "narrow"),
          eq(audit.narrowRuleId, ruleId),
          inArray(audit.status, ["complete", "partial"]),
          gt(audit.createdAt, self.createdAt),
        ),
      )
      .orderBy(desc(audit.createdAt))
      .limit(20)
    const found = candidates.find((c) => {
      const cells = storedCells(c.cells)
      return cells.length > 0 && cells.every((cell) => failedCells.has(cellId(cell)))
    })
    if (found === undefined) return Option.none()
    const verdict = yield* verdictOf(orgId, found.id, ruleId)
    const [total] = yield* db
      .select({ runs: sql<number>`count(*)`.mapWith(Number) })
      .from(run)
      .where(and(eq(run.auditId, found.id), eq(run.role, "target"), eq(run.orgId, orgId)))
    return Option.some({
      auditId: found.id,
      createdAt: found.createdAt,
      failingRuns: verdict.failing,
      determinateRuns: verdict.determinate,
      runs: total?.runs ?? 0,
    })
  })

/** The stored title of a rule as one audit's check results read it; present even when the rule passed. */
export const ruleTitleOf = (orgId: string, auditId: string, ruleId: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const [row] = yield* db
      .select({ title: checkResult.title })
      .from(checkResult)
      .innerJoin(run, eq(run.id, checkResult.runId))
      .where(
        and(
          eq(run.auditId, auditId),
          eq(run.orgId, orgId),
          eq(checkResult.orgId, orgId),
          eq(checkResult.ruleId, ruleId),
        ),
      )
      .limit(1)
    return row?.title ?? null
  })
