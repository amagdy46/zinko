import type { CaptureResult } from "@repo/capture-contract"
import { Scenario } from "@repo/capture-contract"
import { Database } from "@repo/core/Database"
import { checkResult, type finding, hit, run } from "@repo/db"
import type { DigestRun } from "@repo/llm"
import type { EvidenceRef } from "@repo/rules"
import { and, asc, count, eq, inArray } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { decodeEvidence } from "./findings"

const Viewport = Schema.Literals(["desktop", "mobile"])
const Vendor = Schema.Literals(["ga4", "meta", "google-ads", "tiktok"])
const decodeShape = Schema.decodeUnknownEffect(
  Schema.Struct({ scenario: Scenario, viewport: Viewport }),
)
const decodeVendor = Schema.decodeUnknownEffect(Vendor)

/**
 * A failing run of a finding as the database holds it: where its capture is, what it was, the
 * failing check's evidence references and the hit rows they name. Only the hit columns a digest
 * reads are selected: never `params`, `ids` or `url`.
 */
export interface CandidateRun {
  run: {
    id: string
    pageUrl: string
    scenario: string
    viewport: string
    journey: boolean
    captureKey: string | null
  }
  /** Position of the run's page among the audit's distinct run pages, in run order. */
  pageIndex: number
  evidence: ReadonlyArray<EvidenceRef>
  hits: ReadonlyArray<{
    requestId: string
    batchIndex: number
    vendor: string
    destinationId: string
    event: string
    consent: unknown
  }>
}

const HitConsent = Schema.Struct({
  adStorage: Schema.Literals(["granted", "denied", "unknown"]),
  analyticsStorage: Schema.Literals(["granted", "denied", "unknown"]),
  raw: Schema.optionalKey(Schema.String),
})
const decodeConsent = Schema.decodeUnknownEffect(HitConsent)

/**
 * The failing runs of a finding, from the database only (no storage read). `select` is `"all"` for
 * Explain, or `{ candidates: n }` for the report: the first n failing runs in run order. `known`
 * is how many runs could be checked at all (pass or fail).
 */
export const candidateRunsOf = (
  orgId: string,
  auditId: string,
  f: Pick<typeof finding.$inferSelect, "ruleId" | "runIds">,
  select: "all" | { candidates: number },
) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const runs = yield* db
      .select({
        id: run.id,
        pageUrl: run.pageUrl,
        scenario: run.scenario,
        viewport: run.viewport,
        journey: run.journey,
        captureKey: run.captureKey,
      })
      .from(run)
      .where(and(eq(run.auditId, auditId), eq(run.role, "target"), eq(run.orgId, orgId)))
      .orderBy(asc(run.ordinal))
    const pages = [...new Set(runs.map((r) => r.pageUrl))]
    const checks = yield* db
      .select({ runId: checkResult.runId, evidence: checkResult.evidence })
      .from(checkResult)
      .innerJoin(run, eq(run.id, checkResult.runId))
      .where(
        and(
          eq(run.auditId, auditId),
          eq(run.role, "target"),
          eq(run.orgId, orgId),
          eq(checkResult.orgId, orgId),
          eq(checkResult.ruleId, f.ruleId),
          eq(checkResult.status, "fail"),
          inArray(run.id, f.runIds),
        ),
      )
    const [known] = yield* db
      .select({ n: count() })
      .from(checkResult)
      .innerJoin(run, eq(run.id, checkResult.runId))
      .where(
        and(
          eq(run.auditId, auditId),
          eq(run.role, "target"),
          eq(run.orgId, orgId),
          eq(checkResult.orgId, orgId),
          eq(checkResult.ruleId, f.ruleId),
          inArray(checkResult.status, ["pass", "fail"]),
        ),
      )
    const failingIds = new Set(checks.map((c) => c.runId))
    const failing = runs.filter((r) => failingIds.has(r.id))
    const chosen = select === "all" ? failing : failing.slice(0, select.candidates)
    const chosenIds = new Set(chosen.map((r) => r.id))
    const evidenceByRun = new Map<string, ReadonlyArray<EvidenceRef>>()
    for (const check of checks)
      if (chosenIds.has(check.runId))
        evidenceByRun.set(check.runId, yield* decodeEvidence(check.evidence).pipe(Effect.orDie))
    const requestIds = new Set<string>()
    for (const refs of evidenceByRun.values())
      for (const ref of refs)
        if (ref.kind === "hit" || ref.kind === "request") requestIds.add(ref.requestId)
    const hitRows =
      chosen.length === 0 || requestIds.size === 0
        ? []
        : yield* db
            .select({
              runId: hit.runId,
              requestId: hit.requestId,
              batchIndex: hit.batchIndex,
              vendor: hit.vendor,
              destinationId: hit.destinationId,
              event: hit.event,
              consent: hit.consent,
            })
            .from(hit)
            .where(
              and(
                eq(hit.orgId, orgId),
                inArray(
                  hit.runId,
                  chosen.map((r) => r.id),
                ),
                inArray(hit.requestId, [...requestIds]),
              ),
            )
    const candidates = chosen.map((r): CandidateRun => ({
      run: r,
      pageIndex: pages.indexOf(r.pageUrl),
      evidence: evidenceByRun.get(r.id) ?? [],
      hits: hitRows.filter((row) => row.runId === r.id),
    }))
    return { candidates, known: known?.n ?? 0 }
  })

/** A candidate with its stored capture as a `DigestRun`. No I/O: a malformed stored row is a defect. */
export const digestRunOf = (candidate: CandidateRun, capture: CaptureResult) =>
  Effect.gen(function* () {
    const { run: r } = candidate
    const shape = yield* decodeShape(r)
    const hits: DigestRun["hits"][number][] = []
    for (const row of candidate.hits) {
      const request = capture.requests.find((q) => q.id === row.requestId)
      if (request === undefined) continue
      hits.push({
        vendor: yield* decodeVendor(row.vendor),
        destinationId: row.destinationId,
        event: row.event,
        batchIndex: row.batchIndex,
        requestId: row.requestId,
        startedAt: request.startedAt,
        consent: yield* decodeConsent(row.consent),
      })
    }
    return {
      page: { index: candidate.pageIndex, url: r.pageUrl, start: candidate.pageIndex === 0 },
      ...shape,
      journey: r.journey,
      capture,
      hits,
      evidence: candidate.evidence,
    } satisfies DigestRun
  }).pipe(Effect.orDie)
