import { CookieSnapshot } from "@repo/capture-contract"
import { Storage } from "@repo/core"
import { Database } from "@repo/core/Database"
import { audit, checkResult, finding, findingTriage, run } from "@repo/db"
import { createServerFn } from "@tanstack/react-start"
import { and, asc, countDistinct, eq, inArray } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { auditInOrg, hitWithRequest, readCapture, runInAudit } from "./audit-data"
import { requireSession } from "./require-session"
import { membership, NotFound, read, respond } from "./server-fn"

/** Long enough for one look at the evidence; the screen asks again for the next one. */
const SCREENSHOT_URL_SECONDS = 5 * 60

/** `EvidenceRef` from `@repo/rules`, as it comes from the browser and from `check_result`. */
const EvidenceRef = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("hit"), requestId: Schema.String, batchIndex: Schema.Int }),
  Schema.Struct({ kind: Schema.Literal("request"), requestId: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("cookie"),
    label: CookieSnapshot.fields.label,
    documentId: Schema.String,
    name: Schema.String,
    domain: Schema.String,
    path: Schema.String,
  }),
  Schema.Struct({ kind: Schema.Literal("push"), seq: Schema.Int }),
  Schema.Struct({ kind: Schema.Literal("document"), documentId: Schema.String }),
])
const decodeEvidence = Schema.decodeUnknownEffect(Schema.Array(EvidenceRef))
const decodeFix = Schema.decodeUnknownEffect(Schema.Array(Schema.String))

const TriageStatus = Schema.Literals(["open", "accepted_risk", "fixed"])
const decodeTriageStatus = Schema.decodeUnknownEffect(TriageStatus)
const FindingKind = Schema.Literals(["fail", "inconclusive"])
const decodeKind = Schema.decodeUnknownEffect(FindingKind)
const Severity = Schema.Literals(["critical", "warning", "info"])
const decodeSeverity = Schema.decodeUnknownEffect(Severity)

const SEVERITY_ORDER: Record<typeof Severity.Type, number> = { critical: 0, warning: 1, info: 2 }

/** A finding with no triage row is `open`. */
const triageOf = (row: typeof findingTriage.$inferSelect | null) =>
  row === null
    ? Effect.succeed({ status: "open" as const, updatedBy: null, updatedAt: null })
    : decodeTriageStatus(row.status).pipe(
        Effect.orDie,
        Effect.map((status) => ({ status, updatedBy: row.updatedBy, updatedAt: row.updatedAt })),
      )

const triageJoin = and(
  eq(findingTriage.auditId, finding.auditId),
  eq(findingTriage.ruleId, finding.ruleId),
  eq(findingTriage.orgId, finding.orgId),
)

/**
 * The audit's findings, failing ones first by severity, then those that could not be checked.
 * `coverage.evaluatedRuns` counts the runs with check results: 0 means the audit was not
 * evaluated (an M2 audit, or no run reached `persist`), never that it is clean.
 */
export const listFindings = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ auditId: Schema.String })))
  .handler(({ context, data }) =>
    read(
      Effect.gen(function* () {
        const { organizationId: orgId } = yield* membership(context.session)
        const auditId = yield* auditInOrg(orgId, data.auditId)
        const { db } = yield* Database
        // Read first: `finish` writes the findings and settles the status in one transaction, so
        // a finished status here means the reads below see the findings (a later read could not).
        const [current] = yield* db
          .select({ status: audit.status })
          .from(audit)
          .where(and(eq(audit.id, auditId), eq(audit.orgId, orgId)))
          .limit(1)
        if (current === undefined) return yield* new NotFound({ message: "Not found" })
        const runs = yield* db
          .select({ id: run.id, pageUrl: run.pageUrl, scenario: run.scenario })
          .from(run)
          .where(and(eq(run.auditId, auditId), eq(run.orgId, orgId)))
        const evaluated = yield* db
          .select({
            rulesVersion: checkResult.rulesVersion,
            runs: countDistinct(checkResult.runId),
          })
          .from(checkResult)
          .innerJoin(run, eq(run.id, checkResult.runId))
          .where(and(eq(run.auditId, auditId), eq(run.orgId, orgId), eq(checkResult.orgId, orgId)))
          .groupBy(checkResult.rulesVersion)
        const rows = yield* db
          .select({ finding, triage: findingTriage })
          .from(finding)
          .leftJoin(findingTriage, triageJoin)
          .where(and(eq(finding.auditId, auditId), eq(finding.orgId, orgId)))
        const runById = new Map(runs.map((r) => [r.id, r]))
        const findings = yield* Effect.forEach(rows, ({ finding: f, triage }) =>
          Effect.gen(function* () {
            const affected = f.runIds.flatMap((id) => {
              const found = runById.get(id)
              return found === undefined ? [] : [found]
            })
            return {
              ruleId: f.ruleId,
              kind: yield* decodeKind(f.kind).pipe(Effect.orDie),
              area: f.area,
              severity: yield* decodeSeverity(f.severity).pipe(Effect.orDie),
              title: f.title,
              rulesVersions: f.rulesVersions,
              failingRuns: f.failingRuns,
              inconclusiveRuns: f.inconclusiveRuns,
              runIds: f.runIds,
              pages: new Set(affected.map((r) => r.pageUrl)).size,
              scenarios: new Set(affected.map((r) => r.scenario)).size,
              triage: yield* triageOf(triage),
            }
          }),
        )
        return {
          status: current.status,
          coverage: {
            totalRuns: runs.length,
            // a run's check results are written together, with one version
            evaluatedRuns: evaluated.reduce((sum, e) => sum + e.runs, 0),
            rulesVersions: evaluated.map((e) => e.rulesVersion).toSorted(),
          },
          findings: findings.toSorted(
            (a, b) =>
              Number(a.kind === "inconclusive") - Number(b.kind === "inconclusive") ||
              SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
              a.ruleId.localeCompare(b.ruleId),
          ),
        }
      }),
    ),
  )

const FindingInput = Schema.Struct({ auditId: Schema.String, ruleId: Schema.String })

/**
 * One finding: the text stored when it was computed, its triage, and the check result of every
 * failing and inconclusive run, in run order.
 */
export const getFinding = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(FindingInput))
  .handler(({ context, data }) =>
    read(
      Effect.gen(function* () {
        const { organizationId: orgId } = yield* membership(context.session)
        const auditId = yield* auditInOrg(orgId, data.auditId)
        const { db } = yield* Database
        const [found] = yield* db
          .select({ finding, triage: findingTriage })
          .from(finding)
          .leftJoin(findingTriage, triageJoin)
          .where(
            and(
              eq(finding.auditId, auditId),
              eq(finding.orgId, orgId),
              eq(finding.ruleId, data.ruleId),
            ),
          )
          .limit(1)
        if (found === undefined) return yield* new NotFound({ message: "Not found" })
        const { finding: f } = found
        const checks = yield* db
          .select({
            runId: run.id,
            ordinal: run.ordinal,
            pageUrl: run.pageUrl,
            scenario: run.scenario,
            viewport: run.viewport,
            journey: run.journey,
            status: checkResult.status,
            message: checkResult.message,
            rulesVersion: checkResult.rulesVersion,
            evidence: checkResult.evidence,
          })
          .from(checkResult)
          .innerJoin(run, eq(run.id, checkResult.runId))
          .where(
            and(
              eq(run.auditId, auditId),
              eq(run.orgId, orgId),
              eq(checkResult.orgId, orgId),
              eq(checkResult.ruleId, f.ruleId),
              inArray(run.id, f.runIds),
            ),
          )
          .orderBy(asc(run.ordinal))
        return {
          finding: {
            ruleId: f.ruleId,
            kind: yield* decodeKind(f.kind).pipe(Effect.orDie),
            area: f.area,
            severity: yield* decodeSeverity(f.severity).pipe(Effect.orDie),
            title: f.title,
            why: f.why,
            fix: yield* decodeFix(f.fix).pipe(Effect.orDie),
            rulesVersions: f.rulesVersions,
            failingRuns: f.failingRuns,
            inconclusiveRuns: f.inconclusiveRuns,
          },
          triage: yield* triageOf(found.triage),
          checks: yield* Effect.forEach(checks, (check) =>
            decodeEvidence(check.evidence).pipe(
              Effect.orDie,
              Effect.map((evidence) => ({ ...check, evidence })),
            ),
          ),
        }
      }),
    ),
  )

/**
 * Records a member's call on a finding. Any member may triage. The row is kept apart from the
 * finding, so recomputing the audit's findings never loses it.
 */
export const setTriage = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({ auditId: Schema.String, ruleId: Schema.String, status: TriageStatus }),
    ),
  )
  .handler(({ context, data }) =>
    respond(
      Effect.gen(function* () {
        const { organizationId: orgId, userId } = yield* membership(context.session)
        const auditId = yield* auditInOrg(orgId, data.auditId)
        const { db } = yield* Database
        const [found] = yield* db
          .select({ ruleId: finding.ruleId })
          .from(finding)
          .where(
            and(
              eq(finding.auditId, auditId),
              eq(finding.orgId, orgId),
              eq(finding.ruleId, data.ruleId),
            ),
          )
          .limit(1)
        if (found === undefined) return yield* new NotFound({ message: "Not found" })
        const values = { status: data.status, updatedBy: userId, updatedAt: new Date() }
        yield* db
          .insert(findingTriage)
          .values({ auditId, orgId, ruleId: found.ruleId, ...values })
          .onConflictDoUpdate({
            target: [findingTriage.auditId, findingTriage.ruleId],
            set: values,
          })
        return values
      }),
    ),
  )

const EvidenceInput = Schema.Struct({
  auditId: Schema.String,
  runId: Schema.String,
  ref: EvidenceRef,
})

/**
 * What an evidence reference points at, read through the audit: a hit (its decoded row and raw
 * request), a raw request from `capture.json` (including `ccm` pings, which are not decoded), a
 * cookie with the snapshot it was seen in, a `dataLayer` push, or a document. The run's screenshot
 * (taken at the end of the run) comes with it as a signed URL, `null` when there is none.
 */
export const getEvidence = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(EvidenceInput))
  .handler(({ context, data }) =>
    read(
      Effect.gen(function* () {
        const { organizationId: orgId } = yield* membership(context.session)
        const auditId = yield* auditInOrg(orgId, data.auditId)
        const found = yield* runInAudit(orgId, auditId, data.runId)
        const capture = yield* readCapture(found.captureKey)
        const storage = yield* Storage
        const screenshotUrl =
          found.screenshotKey === null
            ? null
            : yield* storage
                .signedUrl(found.screenshotKey, { expiresInSeconds: SCREENSHOT_URL_SECONDS })
                .pipe(Effect.orDie)
        const missing = new NotFound({ message: "Not found" })
        const { ref } = data
        const evidence = yield* Effect.gen(function* () {
          if (ref.kind === "hit") {
            const detail = yield* hitWithRequest(
              orgId,
              found.id,
              capture,
              ref.requestId,
              ref.batchIndex,
            )
            return { kind: ref.kind, ...detail }
          }
          if (ref.kind === "request") {
            const request = capture.requests.find((r) => r.id === ref.requestId)
            if (request === undefined) return yield* missing
            return { kind: ref.kind, request }
          }
          if (ref.kind === "cookie") {
            const snapshot = capture.cookies.find(
              (s) => s.label === ref.label && s.documentId === ref.documentId,
            )
            const cookie = snapshot?.cookies.find(
              (c) => c.name === ref.name && c.domain === ref.domain && c.path === ref.path,
            )
            if (snapshot === undefined || cookie === undefined) return yield* missing
            return {
              kind: ref.kind,
              cookie,
              snapshot: { label: snapshot.label, documentId: snapshot.documentId, at: snapshot.at },
            }
          }
          if (ref.kind === "push") {
            const push = capture.dataLayer[ref.seq]
            if (push === undefined) return yield* missing
            return { kind: ref.kind, seq: ref.seq, ...push }
          }
          const document = capture.documents.find((d) => d.id === ref.documentId)
          if (document === undefined) return yield* missing
          return { kind: ref.kind, document }
        })
        return { evidence, screenshotUrl }
      }),
    ),
  )
