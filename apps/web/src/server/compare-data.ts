import { CaptureResult } from "@repo/capture-contract"
import { AuditConfig } from "@repo/core"
import { Database } from "@repo/core/Database"
import { audit, checkResult, findingTriage, hit, run } from "@repo/db"
import { ruleChangedBetween, VOLATILE_RULES } from "@repo/rules"
import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"
import {
  type AuditRef,
  type CellRun,
  type CheckRow,
  type ConfirmationAudit,
  compareAudits,
  cellKeyOf,
  type Comparison,
  type HistoryAudit,
  type RuleWording,
  recheckTargets,
  scoreDeltaOf,
  type Side,
  type TriageLine,
} from "@/lib/compare"
import { healthScore } from "@/lib/health-score"
import { startPathOfPage } from "@/lib/audit-labels"
import { changesBriefing, refusalOf } from "@/lib/compare-text"
import { vendorName } from "@/lib/tag-matrix"
import { diffTags, type TagRun, type TagTriple } from "@/lib/tag-diff"
import { evaluatedAudit } from "./audit-create"
import { storedCells } from "./cell-key"
import { auditInOrg } from "./audit-data"
import { BANNER_DEPENDENT_RULES, bannerDetection } from "./consent-context"
import { findingsOf } from "./findings-data"
import { Invalid, isUuid, NotFound } from "./server-fn"

/** How many earlier audits are searched for the last time a new failure was already there. */
const HISTORY_AUDITS = 10
const PICKER_AUDITS = 50
const CONFIRMATION_AUDITS = 20

const decodeConsent = Schema.decodeUnknownOption(CaptureResult.fields.consent)
const decodeConfig = Schema.decodeUnknownEffect(AuditConfig)
const isCheckStatus = Schema.is(Schema.Literals(["pass", "fail", "inconclusive", "not_applicable"]))
const isSeverity = Schema.is(Schema.Literals(["critical", "warning", "info"]))

/** Why there is no comparison to show. */
export type NoComparison =
  | "narrow"
  | "audit_active"
  | "audit_failed"
  | "not_evaluated"
  | "no_earlier"
  | "no_baseline"

export interface ComparisonView {
  /** The earlier evaluated full audits of the site the picker may offer, newest first. */
  candidates: AuditRef[]
  /** The stored baseline link, which `against` does not change. */
  baselineId: string | null
  empty: NoComparison | null
  comparison: Comparison | null
}

const refOf = (row: {
  id: string
  createdAt: Date
  status: string
  config: unknown
}): AuditRef => ({
  id: row.id,
  createdAt: row.createdAt.toISOString(),
  status: row.status,
  startPath: startPathOfPage(
    Option.getOrUndefined(Schema.decodeUnknownOption(AuditConfig)(row.config))?.pages[0],
  ),
})

/** Earlier evaluated full audits of the site, before `thanId` in creation order. */
export const earlierAudits = (orgId: string, siteId: string, thanId: string) =>
  and(
    eq(audit.orgId, orgId),
    eq(audit.siteId, siteId),
    eq(audit.kind, "full"),
    inArray(audit.status, ["complete", "partial"]),
    evaluatedAudit(orgId),
    sql`(${audit.createdAt}, ${audit.id}) < (select o.created_at, o.id from audit o where o.id = ${thanId})`,
  )

const cellRunsOf = (orgId: string, auditId: string, config: AuditConfig, withBanner: boolean) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const rows = yield* db
      .select({
        id: run.id,
        pageUrl: run.pageUrl,
        scenario: run.scenario,
        viewport: run.viewport,
        journey: run.journey,
        followHost: run.followHost,
        consent: run.consent,
        decoder: run.decoderVersion,
        status: run.status,
      })
      .from(run)
      .where(and(eq(run.auditId, auditId), eq(run.orgId, orgId), eq(run.role, "target")))
    const banners = withBanner ? yield* bannerDetection(orgId, auditId) : new Map()
    return rows.map((r): CellRun => {
      const outcome = Option.match(decodeConsent(r.consent), {
        onNone: () => null,
        onSome: (consent) => consent.outcome,
      })
      return {
        id: r.id,
        cell: cellKeyOf(r, config),
        compat: {
          consentClass:
            outcome === "accepted" || outcome === "rejected" ? "applied" : "not_applied",
          banner: r.scenario === "none" ? (banners.get(r.id) ?? "unknown") : null,
        },
        decoder: r.decoder,
        complete: r.status === "complete",
      }
    })
  })

const checkRowsOf = (
  orgId: string,
  auditIds: ReadonlyArray<string>,
  ruleIds?: ReadonlyArray<string>,
) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    if (ruleIds?.length === 0) return []
    const rows = yield* db
      .select({
        runId: checkResult.runId,
        ruleId: checkResult.ruleId,
        status: checkResult.status,
        rulesVersion: checkResult.rulesVersion,
      })
      .from(checkResult)
      .innerJoin(run, eq(run.id, checkResult.runId))
      .where(
        and(
          inArray(run.auditId, [...auditIds]),
          eq(run.orgId, orgId),
          eq(run.role, "target"),
          eq(checkResult.orgId, orgId),
          ruleIds === undefined ? undefined : inArray(checkResult.ruleId, [...ruleIds]),
        ),
      )
    return rows.flatMap((r): CheckRow[] =>
      isCheckStatus(r.status) ? [{ ...r, status: r.status }] : [],
    )
  })

/** The stored wording of every rule in the audit: the newest rules version's text. */
const wordingOf = (orgId: string, auditId: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const rows = yield* db
      .select({
        ruleId: checkResult.ruleId,
        rulesVersion: checkResult.rulesVersion,
        title: checkResult.title,
        severity: checkResult.severity,
        area: checkResult.area,
        owner: checkResult.owner,
      })
      .from(checkResult)
      .innerJoin(run, eq(run.id, checkResult.runId))
      .where(and(eq(run.auditId, auditId), eq(run.orgId, orgId), eq(checkResult.orgId, orgId)))
      .groupBy(
        checkResult.ruleId,
        checkResult.rulesVersion,
        checkResult.title,
        checkResult.severity,
        checkResult.area,
        checkResult.owner,
      )
    const newest = new Map<string, { version: number; wording: RuleWording }>()
    for (const r of rows) {
      if (!isSeverity(r.severity)) continue
      const version = Number(r.rulesVersion)
      const held = newest.get(r.ruleId)
      if (held === undefined || version > held.version)
        newest.set(r.ruleId, {
          version,
          wording: { title: r.title, severity: r.severity, area: r.area, owner: r.owner },
        })
    }
    return new Map([...newest].map(([ruleId, { wording }]) => [ruleId, wording]))
  })

const sideOf = (orgId: string, auditId: string, config: AuditConfig) =>
  Effect.gen(function* () {
    const found = yield* findingsOf(orgId, auditId)
    const runs = yield* cellRunsOf(orgId, auditId, config, true)
    const checks = yield* checkRowsOf(orgId, [auditId])
    const wording = yield* wordingOf(orgId, auditId)
    const triage = new Map(
      found.findings.map((f): [string, TriageLine] => [
        f.ruleId,
        {
          status: f.triage.status,
          at: f.triage.updatedAt?.toISOString() ?? null,
          inheritedFrom:
            f.triage.inheritedFrom === null
              ? null
              : {
                  auditId: f.triage.inheritedFrom.auditId,
                  at: f.triage.inheritedFrom.at.toISOString(),
                },
        },
      ]),
    )
    const side: Side = { runs, checks, wording, triage }
    const score = healthScore({
      findings: found.findings.filter((f) => f.kind === "fail"),
      uncertainty: found.uncertainty,
      evaluatedRuns: found.coverage.evaluatedRuns,
      totalRuns: found.coverage.totalRuns,
      versions: found.coverage.rulesVersions,
    })
    return { side, score }
  })

/** The earlier audits, each with its cells and the check rows of the rules that may have regressed. */
const historyOf = (
  orgId: string,
  audits: ReadonlyArray<{ id: string; createdAt: Date; config: unknown }>,
  ruleIds: ReadonlyArray<string>,
) =>
  Effect.gen(function* () {
    if (audits.length === 0 || ruleIds.length === 0) return []
    const checks = yield* checkRowsOf(
      orgId,
      audits.map((a) => a.id),
      ruleIds,
    )
    const { db } = yield* Database
    const runRows = yield* db
      .select({ id: run.id, auditId: run.auditId })
      .from(run)
      .where(
        and(
          inArray(
            run.auditId,
            audits.map((a) => a.id),
          ),
          eq(run.orgId, orgId),
          eq(run.role, "target"),
        ),
      )
    const auditOfRun = new Map(runRows.map((r) => [r.id, r.auditId]))
    const history: HistoryAudit[] = []
    for (const a of audits) {
      const config = yield* decodeConfig(a.config).pipe(Effect.orDie)
      const own = checks.filter((c) => auditOfRun.get(c.runId) === a.id)
      const runs = (yield* cellRunsOf(orgId, a.id, config, true)).filter((r) =>
        own.some((c) => c.runId === r.id),
      )
      history.push({
        auditId: a.id,
        date: a.createdAt.toISOString(),
        startPath: startPathOfPage(config.pages[0]),
        runs,
        checks: own,
      })
    }
    return history
  })

/**
 * The comparison of `auditId` with `againstId` (default: its stored baseline). Both go through the
 * organization; a missing, foreign, newer, other-site, narrow or unevaluated `against` is a 404.
 */
export const comparisonOf = (orgId: string, auditId: string, againstId: string | undefined) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const id = yield* auditInOrg(orgId, auditId)
    if (againstId === id) return yield* new Invalid({ message: "Choose another audit." })
    const [current] = yield* db
      .select()
      .from(audit)
      .where(and(eq(audit.id, id), eq(audit.orgId, orgId)))
      .limit(1)
    if (current === undefined) return yield* new NotFound({ message: "Not found" })
    const newest = yield* db
      .select({
        id: audit.id,
        createdAt: audit.createdAt,
        status: audit.status,
        config: audit.config,
      })
      .from(audit)
      .where(earlierAudits(orgId, current.siteId, id))
      .orderBy(desc(audit.createdAt), desc(audit.id))
      .limit(PICKER_AUDITS)

    // The selected baseline is validated on its own, not found in the capped picker list: an older
    // baseline (stored or `?against=`) is still valid and joins the picker.
    let against = current.baselineAuditId
    if (againstId !== undefined) {
      if (!isUuid(againstId)) return yield* new NotFound({ message: "Not found" })
      against = againstId
    }
    const selected =
      against === null
        ? undefined
        : (yield* db
            .select({
              id: audit.id,
              createdAt: audit.createdAt,
              status: audit.status,
              config: audit.config,
            })
            .from(audit)
            .where(and(earlierAudits(orgId, current.siteId, id), eq(audit.id, against)))
            .limit(1))[0]
    if (againstId !== undefined && selected === undefined)
      return yield* new NotFound({ message: "Not found" })
    const picker = [...newest]
    if (selected !== undefined && !picker.some((c) => c.id === selected.id)) picker.push(selected)
    const candidates = picker
      .toSorted((x, y) => y.createdAt.getTime() - x.createdAt.getTime() || (x.id < y.id ? 1 : -1))
      .map(refOf)
    const view = (empty: NoComparison): ComparisonView => ({
      candidates,
      baselineId: current.baselineAuditId,
      empty,
      comparison: null,
    })

    if (current.kind === "narrow") return view("narrow")
    if (current.status === "queued" || current.status === "running") return view("audit_active")
    if (current.status === "failed") return view("audit_failed")
    const [evaluated] = yield* db
      .select({ ok: evaluatedAudit(orgId) })
      .from(audit)
      .where(eq(audit.id, id))
    if (evaluated?.ok !== true) return view("not_evaluated")
    if (selected === undefined) return view(candidates.length === 0 ? "no_earlier" : "no_baseline")
    const baselineRef = refOf(selected)
    const baseline = selected
    against = selected.id

    const now = yield* sideOf(orgId, id, yield* decodeConfig(current.config).pipe(Effect.orDie))
    const before = yield* sideOf(
      orgId,
      against,
      yield* decodeConfig(baseline.config).pipe(Effect.orDie),
    )
    const failsBefore = new Set(
      before.side.checks.filter((c) => c.status === "fail").map((c) => c.ruleId),
    )
    const newFailures = [
      ...new Set(
        now.side.checks
          .filter((c) => c.status === "fail" && !failsBefore.has(c.ruleId))
          .map((c) => c.ruleId),
      ),
    ]
    const older = yield* db
      .select({ id: audit.id, createdAt: audit.createdAt, config: audit.config })
      .from(audit)
      .where(earlierAudits(orgId, current.siteId, against))
      .orderBy(desc(audit.createdAt), desc(audit.id))
      .limit(HISTORY_AUDITS)

    const shared = {
      before: before.side,
      now: now.side,
      bannerDependent: new Set(BANNER_DEPENDENT_RULES),
      volatile: new Set(Object.keys(VOLATILE_RULES)),
      ruleChanged: ruleChangedBetween,
    }
    // First pass decides which rules changed; only those need their history (regression, flips)
    // and their re-checks read.
    const first = compareAudits({
      ...shared,
      history: yield* historyOf(orgId, older, newFailures),
      confirmations: [],
    })
    const changed = first.findings
      .filter((f) => f.state !== "unchanged" && f.state !== "not_comparable")
      .map((f) => f.ruleId)
    const compared = compareAudits({
      ...shared,
      history: yield* historyOf(orgId, older, [...new Set([...newFailures, ...changed])]),
      confirmations: yield* confirmationsOf(orgId, current.siteId, id, changed),
    })
    const comparison: Comparison = {
      now: refOf(current),
      before: baselineRef,
      ...compared,
      score: scoreDeltaOf(before.score, now.score, compared.comparability),
    }
    return {
      candidates,
      baselineId: current.baselineAuditId,
      empty: null,
      comparison,
    } satisfies ComparisonView
  })

/** One side of a tag diff: its runs as cells, and the distinct tags each complete run sent. */
const tagSideOf = (orgId: string, auditId: string, config: AuditConfig) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const rows = yield* db
      .select({
        id: run.id,
        pageUrl: run.pageUrl,
        scenario: run.scenario,
        viewport: run.viewport,
        journey: run.journey,
        followHost: run.followHost,
        status: run.status,
      })
      .from(run)
      .where(and(eq(run.auditId, auditId), eq(run.orgId, orgId), eq(run.role, "target")))
    const runs = rows.map((r): TagRun => {
      const cell = cellKeyOf(r, config)
      return { id: r.id, cell, cellId: JSON.stringify(cell), complete: r.status === "complete" }
    })
    // grouping in the database keeps this to distinct (run, vendor, destination, event) rows
    const tags: TagTriple[] = yield* db
      .select({
        runId: hit.runId,
        vendor: hit.vendor,
        destinationId: hit.destinationId,
        event: hit.event,
      })
      .from(hit)
      .innerJoin(run, eq(run.id, hit.runId))
      .where(
        and(
          eq(run.auditId, auditId),
          eq(run.orgId, orgId),
          eq(hit.orgId, orgId),
          eq(run.role, "target"),
          eq(run.status, "complete"),
        ),
      )
      .groupBy(hit.runId, hit.vendor, hit.destinationId, hit.event)
    return { runs, tags }
  })

/**
 * The tag-level changes of `auditId` against an earlier audit of the same site: disappeared, new,
 * destination changed and events changed, on the cells both audits captured completely. Both ids go
 * through the organization; the earlier one must be an earlier evaluated full audit of the site.
 */
export const tagDiffOf = (orgId: string, auditId: string, againstId: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const id = yield* auditInOrg(orgId, auditId)
    if (!isUuid(againstId) || againstId === id) return yield* new NotFound({ message: "Not found" })
    const [current] = yield* db
      .select({
        siteId: audit.siteId,
        kind: audit.kind,
        status: audit.status,
        config: audit.config,
      })
      .from(audit)
      .where(and(eq(audit.id, id), eq(audit.orgId, orgId)))
      .limit(1)
    if (current === undefined || current.kind !== "full")
      return yield* new NotFound({ message: "Not found" })
    const [baseline] = yield* db
      .select({ config: audit.config })
      .from(audit)
      .where(and(earlierAudits(orgId, current.siteId, id), eq(audit.id, againstId)))
      .limit(1)
    if (baseline === undefined) return yield* new NotFound({ message: "Not found" })
    const now = yield* tagSideOf(orgId, id, yield* decodeConfig(current.config).pipe(Effect.orDie))
    const before = yield* tagSideOf(
      orgId,
      againstId,
      yield* decodeConfig(baseline.config).pipe(Effect.orDie),
    )
    return diffTags({ before, now })
  })

/** The finished re-checks of the given rules on this site, taken after `auditId`, newest first. */
const confirmationsOf = (
  orgId: string,
  siteId: string,
  auditId: string,
  ruleIds: ReadonlyArray<string>,
) =>
  Effect.gen(function* () {
    if (ruleIds.length === 0) return []
    const { db } = yield* Database
    const narrow = yield* db
      .select({
        id: audit.id,
        ruleId: audit.narrowRuleId,
        cells: audit.narrowCells,
        config: audit.config,
      })
      .from(audit)
      .where(
        and(
          eq(audit.orgId, orgId),
          eq(audit.siteId, siteId),
          eq(audit.kind, "narrow"),
          inArray(audit.status, ["complete", "partial"]),
          inArray(audit.narrowRuleId, [...ruleIds]),
          sql`(${audit.createdAt}, ${audit.id}) > (select o.created_at, o.id from audit o where o.id = ${auditId})`,
        ),
      )
      .orderBy(desc(audit.createdAt), desc(audit.id))
      .limit(CONFIRMATION_AUDITS)
    const found: ConfirmationAudit[] = []
    for (const n of narrow) {
      const targets = storedCells(n.cells)
      if (n.ruleId === null || targets.length === 0) continue
      const config = yield* decodeConfig(n.config).pipe(Effect.orDie)
      found.push({
        auditId: n.id,
        ruleId: n.ruleId,
        targets,
        runs: yield* cellRunsOf(orgId, n.id, config, true),
        checks: yield* checkRowsOf(orgId, [n.id], [n.ruleId]),
      })
    }
    return found
  })

/**
 * What a re-check of `ruleId` in `auditId` would target: the cells the rule fails on in the audit,
 * and in `againstId` when given, and the audit's stored config to narrow. The same validation as a
 * comparison: a foreign, newer or narrow `against`, or a narrow audit, is a 404.
 */
export const recheckPlanOf = (
  orgId: string,
  auditId: string,
  againstId: string | undefined,
  ruleId: string,
) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const id = yield* auditInOrg(orgId, auditId)
    const [current] = yield* db
      .select()
      .from(audit)
      .where(and(eq(audit.id, id), eq(audit.orgId, orgId)))
      .limit(1)
    if (current === undefined || current.kind !== "full")
      return yield* new NotFound({ message: "Not found" })
    if (current.status !== "complete" && current.status !== "partial")
      return yield* new Invalid({ message: "Wait for this audit to finish." })
    let baseline: Side | null = null
    if (againstId !== undefined) {
      if (!isUuid(againstId) || againstId === id)
        return yield* new NotFound({ message: "Not found" })
      const [valid] = yield* db
        .select({ config: audit.config })
        .from(audit)
        .where(and(earlierAudits(orgId, current.siteId, id), eq(audit.id, againstId)))
        .limit(1)
      if (valid === undefined) return yield* new NotFound({ message: "Not found" })
      baseline = (yield* sideOf(
        orgId,
        againstId,
        yield* decodeConfig(valid.config).pipe(Effect.orDie),
      )).side
    }
    const config = yield* decodeConfig(current.config).pipe(Effect.orDie)
    const now = (yield* sideOf(orgId, id, config)).side
    return {
      siteId: current.siteId,
      config,
      targets: recheckTargets({ before: baseline, now }, ruleId),
    }
  })

/**
 * The "What changed" lines of an audit against its stored baseline: null with no baseline, for a
 * re-check, or while the audit has no results to compare. The tag lines are the tags that no longer
 * fire on any run checked completely in both audits.
 */
export const briefingOf = (orgId: string, auditId: string) =>
  Effect.gen(function* () {
    const view = yield* comparisonOf(orgId, auditId, undefined)
    const { comparison } = view
    if (comparison === null) return null
    const tags = yield* tagDiffOf(orgId, auditId, comparison.before.id)
    const gone = tags.changes
      .filter((c) => c.change === "disappeared" && c.cellsAffected === c.cellsCompared)
      .map((c) => `${vendorName(c.vendor)} ${c.destinationId}`)
    if (refusalOf(comparison) !== null) return null
    return { since: comparison.before, lines: changesBriefing(comparison, gone) }
  })

/**
 * A fingerprint of what the audit's comparison reads besides the audit itself, in order: the stored
 * baseline and when it finished, the earlier audits the regression history would search (ids and
 * finish times), every re-check that came after (ids, rule, state, cells, finish times) and the baseline's
 * triage rows as full-row text, `updated_at` included (the wording "Marked fixed on <date>" reads
 * it). A change in any of them can change what the report says, so publication re-reads on a
 * difference. Empty without a baseline.
 */
export const comparisonStampOf = (orgId: string, auditId: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const [own] = yield* db
      .select({ siteId: audit.siteId, baselineId: audit.baselineAuditId })
      .from(audit)
      .where(and(eq(audit.id, auditId), eq(audit.orgId, orgId)))
      .limit(1)
    if (own === undefined || own.baselineId === null) return ""
    const [baseline] = yield* db
      .select({ finishedAt: audit.finishedAt })
      .from(audit)
      .where(and(eq(audit.id, own.baselineId), eq(audit.orgId, orgId)))
    const earlier = yield* db
      .select({ id: audit.id, finishedAt: audit.finishedAt })
      .from(audit)
      .where(earlierAudits(orgId, own.siteId, own.baselineId))
      .orderBy(desc(audit.createdAt), desc(audit.id))
      .limit(HISTORY_AUDITS)
    // Every re-check after the audit, whatever its rule or state and with no cap: a superset of
    // what `confirmationsOf` selects (completed ones of the changed rules, newest 20), so a re-check
    // that finishes while a report is published always changes the stamp. The database folds the
    // rows into one digest (id, rule, state, cells, finish time, in creation order), so nothing but
    // 32 characters travels however many re-checks there are.
    const [rechecks] = yield* db
      .select({
        digest: sql<string>`md5(coalesce(string_agg(concat_ws(',', ${audit.id}, ${audit.narrowRuleId}, ${audit.status}, ${audit.narrowCells}::text, ${audit.finishedAt}::text), '|' order by ${audit.createdAt}, ${audit.id}), ''))`,
      })
      .from(audit)
      .where(
        and(
          eq(audit.orgId, orgId),
          eq(audit.siteId, own.siteId),
          eq(audit.kind, "narrow"),
          sql`(${audit.createdAt}, ${audit.id}) > (select o.created_at, o.id from audit o where o.id = ${auditId})`,
        ),
      )
    const [triage] = yield* db
      .select({
        text: sql<string>`coalesce(string_agg(${findingTriage}::text, '|' order by ${findingTriage.ruleId}), '')`,
      })
      .from(findingTriage)
      .where(and(eq(findingTriage.auditId, own.baselineId), eq(findingTriage.orgId, orgId)))
    const text = JSON.stringify([
      own.baselineId,
      baseline?.finishedAt?.toISOString() ?? null,
      earlier.map((a) => [a.id, a.finishedAt?.toISOString() ?? null]),
      rechecks?.digest ?? "",
      triage?.text ?? "",
    ])
    const bytes = yield* Effect.promise(() =>
      crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    )
    return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
  })
