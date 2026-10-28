import { AuditConfig } from "@repo/core"
import { Database } from "@repo/core/Database"
import { audit, checkResult, client, findingTriage, hit, orgBranding, run, site } from "@repo/db"
import { canonicalJson } from "@repo/llm"
import { and, asc, count, eq, max, sql } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"
import { SCENARIOS, scenarioLabel } from "@/lib/audit-labels"
import { count as plural } from "@/lib/format"
import {
  byText,
  type ConsultantPayload,
  type DisclosureLevel,
  headlinesOf,
  REPORT_MODEL_VERSION,
  type ReportModel,
} from "@/lib/report-model"
import { assertProjected, pageLabel, runReasonLabel, vendorLabel } from "@/lib/report-projection"
import { vendorRank } from "@/lib/tag-matrix"
import { brandingOf } from "./branding-data"
import { auditInOrg } from "./audit-data"
import { findingsOf, SEVERITY_ORDER } from "./findings-data"
import { coverageOf, decodeConsent } from "./matrix-data"
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
  brandingUpdatedAt: string | null
  logoSha256: string | null
  triageUpdatedAt: string | null
  triageCount: number
}

export type ReportBuild =
  | { available: false; reason: "running" | "not-evaluated" }
  | {
      available: true
      model: ReportModel
      publicationHash: string
      consultant: ConsultantPayload
      stamp: ReportStamp
    }

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

/**
 * The report as one validated document, from one consistent read. Phase 1 reads only the database,
 * in a single `REPEATABLE READ` read-only transaction that commits before phase 2 starts; a database
 * error there is fatal. Phase 2 touches no database. Every string in the model comes through
 * `report-projection.ts`, and `assertProjected` checks the finished model before it is returned.
 */
export const buildReport = (orgId: string, auditId: string, detail: DisclosureLevel = "standard") =>
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
          .where(and(eq(run.auditId, auditId), eq(run.orgId, orgId)))
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
          .where(and(eq(run.auditId, auditId), eq(run.orgId, orgId), eq(hit.orgId, orgId)))
          .groupBy(vendorSql, run.scenario)
        const branding = yield* brandingOf(orgId)
        const [brandingRow] = yield* db
          .select({ updatedAt: orgBranding.updatedAt })
          .from(orgBranding)
          .where(eq(orgBranding.orgId, orgId))
          .limit(1)
        const [triage] = yield* db
          .select({ updatedAt: max(findingTriage.updatedAt), rows: count() })
          .from(findingTriage)
          .where(and(eq(findingTriage.auditId, auditId), eq(findingTriage.orgId, orgId)))
        return { head, config, found, runs, failed, hitCells, branding, brandingRow, triage }
      }),
    )
    const { head, config, found, runs, failed, hitCells, branding } = read
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

    const open = failing
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
            scopeLine: `failed on ${top.failingRuns} of ${top.knownRuns} runs where it could be checked, across ${plural(top.pages, "page")} (${scenarioLabels(failed.filter((f) => f.ruleId === top.ruleId).map((f) => f.runId)).join(", ")})`,
          }
    const tally = (status: string) => failing.filter((f) => f.triage.status === status).length
    const bySeverity = (severity: string) => failing.filter((f) => f.severity === severity).length
    const coverage = {
      evaluatedRuns: found.coverage.evaluatedRuns,
      totalRuns: found.coverage.totalRuns,
      unresolvedRules: found.uncertainty.rules,
      bannerUncertainRuns: found.uncertainty.bannerUncertainRuns,
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
        source: "generated",
        text: null,
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
          couldNotCheck: found.findings.filter((f) => f.inconclusiveRuns > 0).length,
          acceptedRisk: tally("accepted_risk"),
          fixed: tally("fixed"),
        },
        headlines: headlinesOf(failing, { ...coverage, unresolvedRuns: found.uncertainty.runs }),
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
      findings: [],
      leftOut: [],
      actionPlan: [],
      appendix: { couldNotCheck: [], notEvaluated: [], rules: [] },
    }
    yield* assertProjected(model, detail)
    return {
      available: true,
      model,
      publicationHash: yield* publicationHashOf(model),
      consultant: {
        edits: { summary: null, detail },
        hiddenFindings: [],
        changesSincePublished: false,
      },
      stamp: {
        auditFinishedAt: head.finishedAt?.toISOString() ?? null,
        brandingUpdatedAt: read.brandingRow?.updatedAt.toISOString() ?? null,
        logoSha256: branding.logoSha256,
        triageUpdatedAt: read.triage?.updatedAt?.toISOString() ?? null,
        triageCount: read.triage?.rows ?? 0,
      },
    } as const
  })
