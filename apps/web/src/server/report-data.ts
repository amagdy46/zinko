import { AuditConfig } from "@repo/core"
import { Database } from "@repo/core/Database"
import {
  audit,
  checkResult,
  client,
  finding as findingTable,
  findingTriage,
  hit,
  orgBranding,
  reportEdit,
  reportFindingEdit,
  run,
  site,
} from "@repo/db"
import { buildDigest, canonicalJson } from "@repo/llm"
import { and, asc, count, eq, sql } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"
import { AREAS, SCENARIOS, scenarioLabel } from "@/lib/audit-labels"
import { pageIndexOf } from "@/lib/page-match"
import { count as plural } from "@/lib/format"
import {
  byText,
  actionPlanOf,
  byFindingOrder,
  decodeReportModel,
  type ConsultantPayload,
  type DisclosureLevel,
  headlinesOf,
  type ReportFinding,
  REPORT_MODEL_VERSION,
  type ReportModel,
} from "@/lib/report-model"
import {
  assertProjected,
  clientVoiceOf,
  evidenceRows,
  NOT_LEGAL_ADVICE,
  notTestedOf,
  pageLabel,
  runReasonLabel,
  vendorLabel,
} from "@/lib/report-projection"
import { vendorRank } from "@/lib/tag-matrix"
import { changesOf } from "@/lib/report-changes"
import { brandingOf } from "./branding-data"
import { comparisonOf, comparisonStampOf, tagDiffOf } from "./compare-data"
import { auditInOrg, type CaptureRead, readCaptureTolerant } from "./audit-data"
import { type CandidateRun, candidateRunsOf, digestRunOf } from "./digest-data"
import { decodeFix, decodeOwner, decodeSeverity, findingsOf, SEVERITY_ORDER } from "./findings-data"
import { coverageOf, decodeConsent } from "./matrix-data"
import { scoreCoverage as scoreCoverageOf, tooLittleCaptured } from "@/lib/health-score"
import { scoreSummaryOf } from "./score-summary"
import { atomically, NotFound } from "./server-fn"

const decodeConfig = Schema.decodeUnknownEffect(AuditConfig)
const decodeErrors = Schema.decodeUnknownEffect(
  Schema.NullOr(Schema.Array(Schema.Struct({ code: Schema.String, message: Schema.String }))),
)

const VIEWPORTS = ["desktop", "mobile"] as const
const VIEWPORT_LABEL = { desktop: "Desktop", mobile: "Mobile" } as const

/**
 * What the input stamp of a build is made of: the facts a consultant can change between reading
 * and publishing. Publication compares two stamps under its lock.
 */
export interface ReportStamp {
  auditFinishedAt: string | null
  /** Fingerprints of the rows' values, not of their timestamps: an update stamped earlier can commit later. */
  branding: string
  edit: string
  findingEdits: string
  triage: string
  /** The ids and values the comparison read: baseline, earlier audits, re-checks, the baseline's triage. */
  comparison: string
}

export type ReportBuild =
  | { available: false; reason: "running" | "not-evaluated" | "narrow" }
  | {
      available: true
      model: ReportModel
      publicationHash: string
      /**
       * Server only, never in the model: a capture read that failed for a reason that may pass
       * (storage or body), so the evidence may be missing for now. Publication refuses while any.
       */
      transientEvidenceFailures: ReadonlyArray<"storage" | "body">
      /** The logo this build read, as the model's digest saw it; a preview URL is signed from this. */
      logo: { key: string; type: string | null; sha256: string | null } | null
      consultant: ConsultantPayload
      stamp: ReportStamp
    }

/** At most this many failing runs are tried, in run order, for a finding's one evidence item. */
const EVIDENCE_CANDIDATES = 5
/** "failed on 3 of 9 runs where it could be checked, on 1 page, in all 3 scenarios": pages and scenarios are those that failed. */
const scopeLineOf = (
  finding: { failingRuns: number; knownRuns: number },
  pages: number,
  scenarios: ReadonlyArray<string>,
  configured: number,
) => {
  let where = `in ${scenarios.join(", ")}`
  if (configured > 1 && scenarios.length === configured) where = `in all ${configured} scenarios`
  return `failed on ${finding.failingRuns} of ${finding.knownRuns} runs where it could be checked, on ${plural(pages, "page")}, ${where}`
}
const VIEWPORT_WORDS = { desktop: "Desktop", mobile: "Mobile" } as const

const viewportOf = (viewport: string) => (viewport === "mobile" ? "mobile" : "desktop")

interface RuleStat {
  ruleId: string
  version: string
  title: string
  area: string
  severity: string
  status: string
  n: number
}

/**
 * The rules this audit was judged by, from its own check results: the wording of the newest rules
 * version of each rule and what happened to it across the runs. A rule added to the registry later
 * does not appear here.
 */
const rulesListOf = (stats: ReadonlyArray<RuleStat>) =>
  Effect.gen(function* () {
    const rules: ReportModel["appendix"]["rules"][number][] = []
    for (const ruleId of new Set(stats.map((s) => s.ruleId))) {
      const own = stats.filter((s) => s.ruleId === ruleId)
      const [newest] = own.toSorted((a, b) => byVersion(b.version, a.version))
      if (newest === undefined) continue
      const total = (status: string) =>
        own.filter((s) => s.status === status).reduce((n, s) => n + s.n, 0)
      rules.push({
        ruleId,
        title: newest.title,
        area: newest.area,
        severity: yield* decodeSeverity(newest.severity).pipe(Effect.orDie),
        version: newest.version,
        pass: total("pass"),
        fail: total("fail"),
        couldNotCheck: total("inconclusive"),
        notApplicable: total("not_applicable"),
      })
    }
    return rules.toSorted(
      (a, b) =>
        Object.keys(AREAS).indexOf(a.area) - Object.keys(AREAS).indexOf(b.area) ||
        byText(a.ruleId, b.ruleId),
    )
  })

const KNOWN_VENDORS = ["ga4", "google-ads", "meta", "tiktok"] as const

/** The hit's vendor with every vendor the decoders do not know folded into one; literals keep select and group by identical. */
const vendorSql = sql<string>`case when ${hit.vendor} in (${sql.raw(KNOWN_VENDORS.map((v) => `'${v}'`).join(", "))}) then ${hit.vendor} else 'other' end`

/** A run whose choice was seen to take effect, with the moment of the click: only then are hits split before and after it. */
const observedSql = sql`(${run.consent}->>'outcome' in ('accepted', 'rejected') and jsonb_typeof(${run.consent}->'actionAt') = 'number')`

interface RunFacts {
  scenario: string
  status: string
  consent: unknown
}

/**
 * Vendor by scenario: for each scenario, how well it was captured (complete, partial or not at
 * all), the outcomes of the choice, the runs and hits per vendor and, for runs whose choice was
 * observed, the hits before and after it. A hit with `after_consent_action = false` is only
 * "before the choice" on those runs: elsewhere there was no choice to be before.
 */
const consentSummaryOf = (
  configured: ReadonlyArray<string>,
  runs: ReadonlyArray<RunFacts>,
  hitCells: ReadonlyArray<{
    vendor: string
    scenario: string
    runsWithHits: number
    hits: number
    hitsBefore: number
    hitsAfter: number
  }>,
): ReportModel["consent"] => {
  const scenarios = SCENARIOS.map((s) => s.value).filter((s) => configured.includes(s))
  const facts = new Map(
    scenarios.map((scenario) => {
      const inScenario = runs.filter((r) => r.scenario === scenario)
      const consents = inScenario.map((r) => Option.getOrNull(decodeConsent(r.consent)))
      const outcomes = new Map<string, number>()
      for (const consent of consents)
        if (consent !== null)
          outcomes.set(consent.outcome, (outcomes.get(consent.outcome) ?? 0) + 1)
      const coverages = inScenario.map((r) => coverageOf(r.status))
      return [
        scenario,
        {
          runs: {
            total: inScenario.length,
            complete: coverages.filter((c) => c === "complete").length,
            partial: coverages.filter((c) => c === "partial").length,
            none: coverages.filter((c) => c === "none").length,
          },
          outcomes: [...outcomes]
            .map(([outcome, n]) => ({ outcome, runs: n }))
            .toSorted((a, b) => byText(a.outcome, b.outcome)),
          observed: consents.filter(
            (c) =>
              c !== null &&
              (c.outcome === "accepted" || c.outcome === "rejected") &&
              c.actionAt !== null,
          ).length,
        },
      ] as const
    }),
  )
  const vendors = [...new Set(hitCells.map((c) => c.vendor))].toSorted(
    (a, b) => vendorRank(a) - vendorRank(b) || byText(a, b),
  )
  return {
    scenarios: scenarios.map(scenarioLabel),
    rows: vendors.map((vendor) => ({
      vendor: vendorLabel(vendor),
      cells: scenarios.map((scenario) => {
        const cell = hitCells.find((c) => c.vendor === vendor && c.scenario === scenario)
        const known = facts.get(scenario)
        return {
          scenario: scenarioLabel(scenario),
          runs: known?.runs ?? { total: 0, complete: 0, partial: 0, none: 0 },
          outcomes: known?.outcomes ?? [],
          runsWithHits: cell?.runsWithHits ?? 0,
          hits: cell?.hits ?? 0,
          choice: {
            observed: known?.observed ?? 0,
            hitsBefore: cell?.hitsBefore ?? 0,
            hitsAfter: cell?.hitsAfter ?? 0,
          },
        }
      }),
    })),
  }
}

const byVersion = (a: string, b: string) => Number(a) - Number(b) || byText(a, b)

/** sha256 of the model without `generatedAt`, then a newline, then the logo's digest: what a reader would see. */
const publicationHashOf = (model: ReportModel) =>
  Effect.promise(async () => {
    const { generatedAt: _generatedAt, ...stable } = model
    const text = `${canonicalJson(stable)}\n${model.branding.logoDigest ?? ""}`
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
    return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
  })

/** A fingerprint of the values of a table's rows (the table name and column are ours, never input). */
const rowsOf = (table: string, order: string) =>
  sql<string>`md5(coalesce(string_agg(${sql.raw(table)}::text, '|' order by ${sql.raw(order)}), ''))`

/**
 * The inputs a consultant can change, read in a few small queries. `buildReport` takes it inside
 * its snapshot; publication takes it again under the lock and starts over when the two differ.
 */
export const readStamp = (orgId: string, auditId: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const [head] = yield* db
      .select({ finishedAt: audit.finishedAt })
      .from(audit)
      .where(and(eq(audit.id, auditId), eq(audit.orgId, orgId)))
      .limit(1)
    const [branding] = yield* db
      .select({ fingerprint: rowsOf("org_branding", "org_id") })
      .from(orgBranding)
      .where(eq(orgBranding.orgId, orgId))
    const [edit] = yield* db
      .select({ fingerprint: rowsOf("report_edit", "audit_id") })
      .from(reportEdit)
      .where(and(eq(reportEdit.auditId, auditId), eq(reportEdit.orgId, orgId)))
    const [findingEdits] = yield* db
      .select({ fingerprint: rowsOf("report_finding_edit", "rule_id") })
      .from(reportFindingEdit)
      .where(and(eq(reportFindingEdit.auditId, auditId), eq(reportFindingEdit.orgId, orgId)))
    const [triage] = yield* db
      .select({ fingerprint: rowsOf("finding_triage", "rule_id") })
      .from(findingTriage)
      .where(and(eq(findingTriage.auditId, auditId), eq(findingTriage.orgId, orgId)))
    return {
      auditFinishedAt: head?.finishedAt?.toISOString() ?? null,
      branding: branding?.fingerprint ?? "",
      edit: edit?.fingerprint ?? "",
      findingEdits: findingEdits?.fingerprint ?? "",
      triage: triage?.fingerprint ?? "",
      comparison: yield* comparisonStampOf(orgId, auditId),
    } satisfies ReportStamp
  })

/**
 * The report as one validated document, from one consistent read. Phase 1 reads only the database,
 * in a single `REPEATABLE READ` read-only transaction that commits before phase 2 starts; a database
 * error there is fatal. Phase 2 touches no database. Every string in the model comes through
 * `report-projection.ts`, and `assertProjected` checks the finished model before it is returned.
 */
export const buildReport = (orgId: string, auditId: string) =>
  Effect.gen(function* () {
    const read = yield* atomically(
      Effect.gen(function* () {
        const { db } = yield* Database
        yield* db.execute(sql`set transaction isolation level repeatable read read only`)
        yield* auditInOrg(orgId, auditId)
        const [head] = yield* db
          .select({
            config: audit.config,
            status: audit.status,
            kind: audit.kind,
            createdAt: audit.createdAt,
            finishedAt: audit.finishedAt,
            clientName: client.name,
            siteName: site.name,
            host: site.host,
          })
          .from(audit)
          .innerJoin(site, eq(site.id, audit.siteId))
          .innerJoin(client, eq(client.id, site.clientId))
          .where(and(eq(audit.id, auditId), eq(audit.orgId, orgId)))
          .limit(1)
        if (head === undefined) return yield* new NotFound({ message: "Not found" })
        const config = yield* decodeConfig(head.config).pipe(Effect.orDie)
        const found = yield* findingsOf(orgId, auditId)
        const runRows = yield* db
          .select({
            id: run.id,
            pageUrl: run.pageUrl,
            scenario: run.scenario,
            viewport: run.viewport,
            journey: run.journey,
            status: run.status,
            failure: run.failure,
            errors: run.errors,
            consent: run.consent,
          })
          .from(run)
          .where(and(eq(run.auditId, auditId), eq(run.role, "target"), eq(run.orgId, orgId)))
          .orderBy(asc(run.ordinal))
        const runs = yield* Effect.forEach(runRows, (r) =>
          Effect.map(decodeErrors(r.errors).pipe(Effect.orDie), (errors) => ({
            ...r,
            errors: errors ?? [],
          })),
        )
        const failed = yield* db
          .select({ ruleId: checkResult.ruleId, runId: checkResult.runId })
          .from(checkResult)
          .innerJoin(run, eq(run.id, checkResult.runId))
          .where(
            and(
              eq(run.auditId, auditId),
              eq(run.role, "target"),
              eq(run.orgId, orgId),
              eq(checkResult.orgId, orgId),
              eq(checkResult.status, "fail"),
            ),
          )
        const hitCells = yield* db
          .select({
            vendor: vendorSql,
            scenario: run.scenario,
            runsWithHits: sql<number>`count(distinct ${hit.runId})`.mapWith(Number),
            hits: sql<number>`count(*)`.mapWith(Number),
            hitsBefore:
              sql<number>`count(*) filter (where ${observedSql} and not ${hit.afterConsentAction})`.mapWith(
                Number,
              ),
            hitsAfter:
              sql<number>`count(*) filter (where ${observedSql} and ${hit.afterConsentAction})`.mapWith(
                Number,
              ),
          })
          .from(hit)
          .innerJoin(run, eq(run.id, hit.runId))
          .where(
            and(
              eq(run.auditId, auditId),
              eq(run.role, "target"),
              eq(run.orgId, orgId),
              eq(hit.orgId, orgId),
            ),
          )
          .groupBy(vendorSql, run.scenario)
        const ruleStats = yield* db
          .select({
            ruleId: checkResult.ruleId,
            version: checkResult.rulesVersion,
            title: checkResult.title,
            area: checkResult.area,
            severity: checkResult.severity,
            status: checkResult.status,
            n: count(),
          })
          .from(checkResult)
          .innerJoin(run, eq(run.id, checkResult.runId))
          .where(
            and(
              eq(run.auditId, auditId),
              eq(run.role, "target"),
              eq(run.orgId, orgId),
              eq(checkResult.orgId, orgId),
            ),
          )
          .groupBy(
            checkResult.ruleId,
            checkResult.rulesVersion,
            checkResult.title,
            checkResult.area,
            checkResult.severity,
            checkResult.status,
          )
        const wording = yield* db
          .select({ ruleId: findingTable.ruleId, why: findingTable.why, fix: findingTable.fix })
          .from(findingTable)
          .where(
            and(
              eq(findingTable.auditId, auditId),
              eq(findingTable.orgId, orgId),
              eq(findingTable.kind, "fail"),
            ),
          )
        const candidates = new Map<string, ReadonlyArray<CandidateRun>>()
        for (const f of found.findings)
          if (f.kind === "fail")
            candidates.set(
              f.ruleId,
              (yield* candidateRunsOf(orgId, auditId, f, { candidates: EVIDENCE_CANDIDATES }))
                .candidates,
            )
        const [edit] = yield* db
          .select({
            summary: reportEdit.summary,
            detail: reportEdit.detail,
            includeChanges: reportEdit.includeChanges,
            updatedAt: reportEdit.updatedAt,
          })
          .from(reportEdit)
          .where(and(eq(reportEdit.auditId, auditId), eq(reportEdit.orgId, orgId)))
          .limit(1)
        const findingEdits = yield* db
          .select({
            ruleId: reportFindingEdit.ruleId,
            note: reportFindingEdit.note,
            hidden: reportFindingEdit.hidden,
            owner: reportFindingEdit.owner,
            updatedAt: reportFindingEdit.updatedAt,
            carried: sql<boolean>`${reportFindingEdit.inheritedFromAt} is not null`,
          })
          .from(reportFindingEdit)
          .where(and(eq(reportFindingEdit.auditId, auditId), eq(reportFindingEdit.orgId, orgId)))
        const branding = yield* brandingOf(orgId)
        const { comparison } = yield* comparisonOf(orgId, auditId, undefined)
        const tags =
          comparison === null ? null : yield* tagDiffOf(orgId, auditId, comparison.before.id)
        const stamp = yield* readStamp(orgId, auditId)
        return {
          comparison,
          tags,
          head,
          config,
          found,
          runs,
          failed,
          hitCells,
          ruleStats,
          wording,
          candidates,
          edit,
          findingEdits,
          branding,
          stamp,
        }
      }),
    )
    const {
      comparison,
      tags,
      head,
      config,
      found,
      runs,
      failed,
      hitCells,
      ruleStats,
      wording,
      candidates,
      edit,
      findingEdits,
      branding,
    } = read
    const detail: DisclosureLevel = edit?.detail === "detailed" ? "detailed" : "standard"
    if (head.kind === "narrow") return { available: false, reason: "narrow" } as const
    if (head.status === "queued" || head.status === "running")
      return { available: false, reason: "running" } as const
    if (found.coverage.evaluatedRuns === 0)
      return { available: false, reason: "not-evaluated" } as const

    const failing = found.findings.filter((f) => f.kind === "fail")
    const summary = scoreSummaryOf({
      findings: failing,
      uncertainty: found.uncertainty,
      coverage: found.coverage,
      runs,
      startUrl: config.pages[0],
      reasonOf: runReasonLabel,
    })
    if (!summary.score.evaluated) return { available: false, reason: "not-evaluated" } as const
    const scored = {
      ...summary.score,
      lines: summary.score.lines.toSorted(
        (a, b) =>
          SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
          b.points - a.points ||
          byText(a.ruleId, b.ruleId),
      ),
      versions: summary.score.versions.toSorted(byVersion),
    }
    const label = (url: string, journey: boolean) => pageLabel(config.pages, url, journey, detail)
    const startUrl = config.pages[0]
    const runById = new Map(runs.map((r) => [r.id, r]))
    const scenarioLabels = (ids: ReadonlyArray<string>) =>
      SCENARIOS.map((s) => s.value)
        .filter((scenario) => ids.some((id) => runById.get(id)?.scenario === scenario))
        .map(scenarioLabel)

    const leftOutIds = new Set(findingEdits.filter((e) => e.hidden).map((e) => e.ruleId))
    const changed =
      comparison === null || tags === null
        ? null
        : changesOf({ comparison, tags, hidden: leftOutIds, detail })
    const detailed = failing.filter((f) => !leftOutIds.has(f.ruleId))
    const open = detailed
      .filter((f) => f.triage.status === "open")
      .toSorted(
        (a, b) =>
          SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
          b.failingRuns - a.failingRuns ||
          byText(a.ruleId, b.ruleId),
      )
    const [top] = open
    const worst =
      top === undefined
        ? null
        : {
            ruleId: top.ruleId,
            severity: top.severity,
            title: top.title,
            scopeLine: scopeLineOf(
              top,
              new Set(
                failed
                  .filter((f) => f.ruleId === top.ruleId)
                  .flatMap((f) => {
                    const r = runById.get(f.runId)
                    return r === undefined ? [] : [pageIndexOf(config.pages, r.pageUrl)]
                  }),
              ).size,
              scenarioLabels(failed.filter((f) => f.ruleId === top.ruleId).map((f) => f.runId)),
              config.scenarios.length,
            ),
          }
    const tally = (status: string) => failing.filter((f) => f.triage.status === status).length
    const bySeverity = (severity: string) => failing.filter((f) => f.severity === severity).length
    const unchecked = found.findings.filter((f) => f.kind === "inconclusive")
    const coverage = {
      evaluatedRuns: found.coverage.evaluatedRuns,
      totalRuns: found.coverage.totalRuns,
      unresolvedRules: unchecked.length,
      unresolvedRuns: new Set(unchecked.flatMap((f) => f.runIds)).size,
      bannerUncertainRuns: found.uncertainty.bannerUncertainRuns,
    }
    const blockedPages = new Set(summary.runHealth.brokenPages.map((p) => p.page))
    const blockedRuns = new Set(
      runs
        .filter(
          (r) =>
            blockedPages.has(r.pageUrl) ||
            (summary.runHealth.startFailed &&
              startUrl !== undefined &&
              pageIndexOf([startUrl], r.pageUrl) === 0),
        )
        .map((r) => r.id),
    )
    const isNever = (f: (typeof unchecked)[number]) =>
      f.knownRuns === 0 && f.inconclusiveRuns >= coverage.evaluatedRuns
    const isBlocked = (f: (typeof unchecked)[number]) =>
      !isNever(f) && f.runIds.some((id) => blockedRuns.has(id))
    const neverChecked = unchecked.filter(isNever)
    const otherChecks = unchecked.filter((f) => !isNever(f) && !isBlocked(f))
    const checkGaps = {
      blockedRules: unchecked.filter(isBlocked).length,
      neverChecked: neverChecked.map((f) => f.checkTitle).toSorted(byText),
      otherRules: otherChecks.length,
      otherRuns: new Set(otherChecks.flatMap((f) => f.runIds)).size,
    }
    const scoreCoverage = {
      checks: ruleStats.reduce((n, s) => n + s.n, 0),
      unresolvedChecks: ruleStats
        .filter((s) => s.status === "inconclusive")
        .reduce((n, s) => n + s.n, 0),
    }
    const covered = {
      totalRuns: coverage.totalRuns,
      evaluatedRuns: coverage.evaluatedRuns,
      unfinishedRuns: summary.runHealth.unfinishedRuns,
      ...scoreCoverage,
      unauditedSites: 0,
    }
    const wordingOf = new Map(wording.map((w) => [w.ruleId, w]))
    const captures = new Map<string, CaptureRead>()
    const captureOf = (candidate: CandidateRun) =>
      Effect.gen(function* () {
        const key = candidate.run.captureKey
        const cached = key === null ? undefined : captures.get(key)
        if (cached !== undefined) return cached
        const fetched = yield* readCaptureTolerant(key, candidate.run.id)
        if (key !== null) captures.set(key, fetched)
        return fetched
      })
    const findings: ReportFinding[] = []
    const hiddenFindings: ReportFinding[] = []
    const transientEvidenceFailures = new Set<"storage" | "body">()
    const editOf = new Map(findingEdits.map((e) => [e.ruleId, e]))
    const destinations = new Set<string>()
    for (const f of failing.toSorted(byFindingOrder)) {
      const stored = wordingOf.get(f.ruleId)
      if (stored === undefined) continue
      const affected = f.runIds.flatMap((id) => {
        const r = runById.get(id)
        return r === undefined ? [] : [r]
      })
      const pageOrder = (r: (typeof affected)[number]) => {
        return Number(r.journey) * config.pages.length + pageIndexOf(config.pages, r.pageUrl)
      }
      const pages = [
        ...new Map(
          affected
            .toSorted((a, b) => pageOrder(a) - pageOrder(b))
            .map((r) => [label(r.pageUrl, r.journey), r]),
        ).keys(),
      ]
      let evidence: ReportFinding["evidence"] = null
      for (const candidate of candidates.get(f.ruleId) ?? []) {
        const fetched = yield* captureOf(candidate)
        if (!fetched.found) {
          if (fetched.reason === "storage" || fetched.reason === "body")
            transientEvidenceFailures.add(fetched.reason)
          continue
        }
        const digestRun = yield* digestRunOf(candidate, fetched.capture)
        const digest = buildDigest(
          {
            ruleId: f.ruleId,
            rulesVersions: f.rulesVersions,
            area: f.area,
            severity: f.severity,
            title: f.title,
            why: stored.why,
            fix: yield* decodeFix(stored.fix).pipe(Effect.orDie),
            failingRuns: f.failingRuns,
            knownRuns: f.knownRuns,
          },
          [digestRun],
          { includePagePaths: false },
        )
        const facts = digest.cases[0]?.evidence ?? []
        const rows = evidenceRows(facts, detail)
        if (rows.length === 0) continue
        const shown = new Set(rows.map((row) => row.destination))
        for (const row of evidenceRows(facts, "detailed"))
          if (row.destination !== null && !shown.has(row.destination))
            destinations.add(row.destination)
        const { run: r } = candidate
        evidence = {
          caption: `Seen on ${label(r.pageUrl, r.journey)}, ${scenarioLabel(r.scenario)}, ${
            VIEWPORT_WORDS[digestRun.viewport]
          }`,
          rows,
        }
        break
      }
      const edited = editOf.get(f.ruleId)
      const owner =
        edited?.owner === undefined || edited.owner === null
          ? f.owner
          : yield* decodeOwner(edited.owner).pipe(Effect.orDie)
      let ownerSource: ReportFinding["ownerSource"] = f.owner === null ? "none" : "rule"
      if (edited?.owner) ownerSource = "author"
      const entry: ReportFinding = {
        ruleId: f.ruleId,
        severity: f.severity,
        area: f.area,
        title: f.title,
        why: stored.why,
        clientVoice: clientVoiceOf(f),
        fix: yield* decodeFix(stored.fix).pipe(Effect.orDie),
        owner,
        ownerSource,
        failingRuns: f.failingRuns,
        knownRuns: f.knownRuns,
        pages,
        scenarios: scenarioLabels(f.runIds),
        bannerUncertainRuns: f.bannerUncertainRuns,
        triage: {
          status: f.triage.status,
          reason: f.triage.status === "accepted_risk" ? f.triage.reason : null,
        },
        note: edited?.note ?? null,
        evidence,
      }
      if (edited?.hidden === true) hiddenFindings.push(entry)
      else findings.push(entry)
    }
    const generatedAt = new Date()
    const model: ReportModel = {
      modelVersion: REPORT_MODEL_VERSION,
      generatedAt: generatedAt.toISOString(),
      detail,
      branding: {
        agencyName: branding.agencyName,
        accent: branding.accent,
        footerText: branding.footerText,
        showPoweredBy: branding.showPoweredBy,
        logoDigest: branding.logoSha256,
      },
      cover: {
        clientName: head.clientName,
        siteName: head.siteName,
        host: head.host,
        auditedAt: (head.finishedAt ?? head.createdAt).toISOString(),
        scope: {
          pages: config.pages.map((url) => label(url, false)),
          scenarios: SCENARIOS.map((s) => s.value)
            .filter((scenario) => config.scenarios.includes(scenario))
            .map(scenarioLabel),
          viewports: VIEWPORTS.filter((v) => config.viewports.includes(v)).map(
            (v) => VIEWPORT_LABEL[v],
          ),
          journey: config.journey === true,
          clickIds: config.clickIds,
        },
      },
      summary: {
        source: edit?.summary ? "author" : "generated",
        text: edit?.summary ?? null,
        score: scored,
        withoutAccepted: summary.withoutAccepted,
        runHealth: {
          ...summary.runHealth,
          startPage: startUrl === undefined ? null : label(startUrl, false),
          brokenPages: summary.runHealth.brokenPages.map((p) => ({
            page: label(p.page, false),
            reason: p.reason,
          })),
        },
        counts: {
          critical: bySeverity("critical"),
          warning: bySeverity("warning"),
          info: bySeverity("info"),
          couldNotCheck: unchecked.length,
          acceptedRisk: tally("accepted_risk"),
          fixed: tally("fixed"),
        },
        scoreCoverage,
        checkGaps,
        headlines: headlinesOf(detailed, {
          evaluatedRuns: coverage.evaluatedRuns,
          totalRuns: coverage.totalRuns,
          unresolvedRules: coverage.unresolvedRules,
          leftOut: failing.length - detailed.length,
          partial: scoreCoverageOf(covered).state === "runs",
          tooLittle: tooLittleCaptured(covered),
        }),
        coverage,
        worst,
      },
      method: {
        rulesVersions: found.coverage.rulesVersions.toSorted(byVersion),
        scoreVersion: scored.version,
        runs: {
          complete: runs.filter((r) => r.status === "complete").length,
          partial: runs.filter((r) => r.status === "partial").length,
          failed: runs.filter((r) => r.status === "failed").length,
        },
        mixedVersions: scored.mixedVersions,
      },
      consent: consentSummaryOf(config.scenarios, runs, hitCells),
      findings,
      changes: edit?.includeChanges === false ? null : (changed?.changes ?? null),
      limits: {
        disclaimer: NOT_LEGAL_ADVICE,
        notTested: notTestedOf({
          scenarios: config.scenarios,
          viewports: config.viewports,
          pages: config.pages.length,
          journey: config.journey === true,
          clickIds: config.clickIds,
          runs: {
            complete: runs.filter((r) => r.status === "complete").length,
            partial: runs.filter((r) => r.status === "partial").length,
            failed: runs.filter((r) => r.status === "failed").length,
          },
          bannerUncertainRuns: coverage.bannerUncertainRuns,
          checksNotRun: checkGaps.neverChecked.length,
          checksPartlyRun: checkGaps.blockedRules + checkGaps.otherRules,
        }),
      },
      leftOut: hiddenFindings
        .map((f) => ({ ruleId: f.ruleId, title: f.title }))
        .toSorted((a, b) => byText(a.ruleId, b.ruleId)),
      actionPlan: actionPlanOf(findings),
      appendix: {
        couldNotCheck: unchecked
          .map((f) => ({ ruleId: f.ruleId, checkTitle: f.checkTitle, runs: f.inconclusiveRuns }))
          .toSorted((a, b) => byText(a.checkTitle, b.checkTitle) || byText(a.ruleId, b.ruleId)),
        notEvaluated: runs
          .filter((r) => r.status === "partial" || r.status === "failed")
          .map((r) => ({
            page: label(r.pageUrl, r.journey),
            scenario: scenarioLabel(r.scenario),
            viewport: VIEWPORT_WORDS[viewportOf(r.viewport)],
            reason: runReasonLabel(r) ?? "The run did not finish",
          })),
        rules: yield* rulesListOf(ruleStats),
      },
    }
    yield* decodeReportModel(model, { onExcessProperty: "error" }).pipe(Effect.orDie)
    yield* assertProjected(model, detail)
    return {
      available: true,
      model,
      publicationHash: yield* publicationHashOf(model),
      transientEvidenceFailures: [...transientEvidenceFailures],
      logo:
        branding.logoKey === null
          ? null
          : { key: branding.logoKey, type: branding.logoType, sha256: branding.logoSha256 },
      consultant: {
        edits: {
          summary: edit?.summary ?? null,
          detail,
          includeChanges: edit?.includeChanges !== false,
        },
        changeRows:
          comparison === null || changed === null
            ? null
            : { against: comparison.before.id, items: changed.rows },
        hiddenFindings,
        carriedNotes: findings.filter(
          (f) => f.note !== null && editOf.get(f.ruleId)?.carried === true,
        ).length,
        disclosure: {
          pages: [
            ...config.pages.map((url) => pageLabel(config.pages, url, false, "detailed")),
            ...(config.journey === true && startUrl !== undefined
              ? [pageLabel(config.pages, startUrl, true, "detailed")]
              : []),
          ],
          destinations: [...destinations].toSorted(byText),
        },
        changesSincePublished: false,
      },
      stamp: read.stamp,
    } as const
  })
