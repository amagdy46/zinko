import { CookieSnapshot } from "@repo/capture-contract"
import { Storage } from "@repo/core"
import { Database } from "@repo/core/Database"
import { checkResult, findingTriage, member, run, user } from "@repo/db"
import { createServerFn } from "@tanstack/react-start"
import { and, asc, eq, inArray } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"
import { auditInOrg, hitWithRequest, readCapture, runInAudit } from "./audit-data"
import { BANNER_DEPENDENT_RULES, bannerDetection } from "./consent-context"
import {
  checkTitleOf,
  decodeFix,
  decodeOwner,
  decodeKind,
  decodeSeverity,
  findingRowOf,
  findingsOf,
  triageOf,
  TriageStatus,
} from "./findings-data"
import { latestRecheckOf } from "./recheck-data"
import { requireSession } from "./require-session"
import { Invalid, membership, NotFound, read, mutation } from "./server-fn"

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
export const decodeEvidence = Schema.decodeUnknownEffect(Schema.Array(EvidenceRef))

const MAX_REASON = 1000

export const listFindings = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ auditId: Schema.String })))
  .handler(({ context, data }) =>
    read(
      Effect.gen(function* () {
        const { organizationId: orgId } = yield* membership(context.session)
        const auditId = yield* auditInOrg(orgId, data.auditId)
        return yield* findingsOf(orgId, auditId)
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
        const found = yield* findingRowOf(orgId, auditId, data.ruleId)
        const { finding: f } = found
        const [actor] =
          found.triage === null
            ? []
            : yield* db
                .select({ name: user.name })
                .from(member)
                .innerJoin(user, eq(user.id, member.userId))
                .where(
                  and(eq(member.organizationId, orgId), eq(member.userId, found.triage.updatedBy)),
                )
                .limit(1)
        const checks = yield* db
          .select({
            runId: run.id,
            ordinal: run.ordinal,
            pageUrl: run.pageUrl,
            scenario: run.scenario,
            viewport: run.viewport,
            journey: run.journey,
            followHost: run.followHost,
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
              eq(run.role, "target"),
              eq(run.orgId, orgId),
              eq(checkResult.orgId, orgId),
              eq(checkResult.ruleId, f.ruleId),
              inArray(run.id, f.runIds),
            ),
          )
          .orderBy(asc(run.ordinal))
        const detection = yield* bannerDetection(orgId, auditId)
        const recheck = Option.getOrNull(yield* latestRecheckOf(orgId, auditId, f.ruleId))
        return {
          recheck,
          finding: {
            ruleId: f.ruleId,
            kind: yield* decodeKind(f.kind).pipe(Effect.orDie),
            area: f.area,
            severity: yield* decodeSeverity(f.severity).pipe(Effect.orDie),
            title: f.title,
            checkTitle: checkTitleOf(f.checkTitle, f.ruleId, f.area),
            owner: yield* decodeOwner(f.owner).pipe(Effect.orDie),
            why: f.why,
            fix: yield* decodeFix(f.fix).pipe(Effect.orDie),
            rulesVersions: f.rulesVersions,
            failingRuns: f.failingRuns,
            inconclusiveRuns: f.inconclusiveRuns,
          },
          triage: {
            ...(yield* triageOf(found.triage, found.originExists)),
            updatedByName: actor?.name ?? null,
          },
          checks: yield* Effect.forEach(checks, (check) =>
            decodeEvidence(check.evidence).pipe(
              Effect.orDie,
              Effect.map((evidence) => ({
                ...check,
                evidence,
                bannerDetection:
                  check.status === "fail" && BANNER_DEPENDENT_RULES.includes(f.ruleId)
                    ? (detection.get(check.runId) ?? null)
                    : null,
              })),
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
      Schema.Struct({
        auditId: Schema.String,
        ruleId: Schema.String,
        status: TriageStatus,
        reason: Schema.optional(Schema.String),
      }),
    ),
  )
  .handler(({ context, data }) =>
    mutation(
      Effect.gen(function* () {
        const { organizationId: orgId, userId } = yield* membership(context.session)
        const auditId = yield* auditInOrg(orgId, data.auditId)
        const reason = data.status === "accepted_risk" ? (data.reason?.trim() ?? "") : null
        if (reason === "") return yield* new Invalid({ message: "Say why the risk is accepted." })
        if (reason !== null && reason.length > MAX_REASON)
          return yield* new Invalid({
            message: `The reason can be at most ${MAX_REASON} characters.`,
          })
        const { db } = yield* Database
        const { finding: found } = yield* findingRowOf(orgId, auditId, data.ruleId)
        const values = { status: data.status, reason, updatedBy: userId, updatedAt: new Date() }
        // an edit is this audit's own call, so a carried-over marker goes
        const written = { ...values, inheritedFromAuditId: null, inheritedFromAt: null }
        yield* db
          .insert(findingTriage)
          .values({ auditId, orgId, ruleId: found.ruleId, ...written })
          .onConflictDoUpdate({
            target: [findingTriage.auditId, findingTriage.ruleId],
            set: written,
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
