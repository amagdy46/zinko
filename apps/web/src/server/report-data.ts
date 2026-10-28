import { AuditConfig } from "@repo/core"
import { Database } from "@repo/core/Database"
import { audit, checkResult, client, findingTriage, orgBranding, run, site } from "@repo/db"
import { canonicalJson } from "@repo/llm"
import { and, asc, count, eq, max, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"
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
import { assertProjected, pageLabel, runReasonLabel } from "@/lib/report-projection"
import { brandingOf } from "./branding-data"
import { auditInOrg } from "./audit-data"
import { findingsOf, SEVERITY_ORDER } from "./findings-data"
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
        return { head, config, found, runs, failed, branding, brandingRow, triage }
      }),
    )
    const { head, config, found, runs, failed, branding } = read
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
      consent: { scenarios: [], rows: [] },
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
