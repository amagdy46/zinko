import { Scenario } from "@repo/capture-contract"
import { Llm, type LlmModel } from "@repo/core/llm"
import { Database } from "@repo/core/Database"
import { checkResult, finding, hit, run } from "@repo/db"
import {
  buildDigest,
  buildExplainPrompt,
  type DigestRun,
  EXPLAIN_PROMPT_VERSION,
  evidenceHash,
  type Explanation,
  type FindingDigest,
  parseExplanation,
} from "@repo/llm"
import type { DecodedHit, EvidenceRef } from "@repo/rules"
import { createServerFn } from "@tanstack/react-start"
import { and, asc, count, eq, inArray } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"
import { aiPolicyOf } from "./ai-policy-data"
import { auditInOrg, decodeHitColumns, readCapture } from "./audit-data"
import {
  cachedFor,
  type CachedExplanation,
  findCached,
  keyHashOf,
  type LookupKey,
  MAX_ATTEMPTS,
  publish,
  reserve,
  settle,
} from "./explain-ledger"
import { decodeEvidence, decodeFix } from "./findings"
import { decodeSeverity } from "./findings-data"
import { requireSession } from "./require-session"
import { Forbidden, Invalid, isManager, membership, NotFound, respond } from "./server-fn"

const Viewport = Schema.Literals(["desktop", "mobile"])
const Vendor = Schema.Literals(["ga4", "meta", "google-ads", "tiktok"])
const decodeShape = Schema.decodeUnknownEffect(
  Schema.Struct({ scenario: Scenario, viewport: Viewport }),
)
const decodeVendor = Schema.decodeUnknownEffect(Vendor)

const FindingInput = Schema.Struct({ auditId: Schema.String, ruleId: Schema.String })
const ExplainInput = Schema.Struct({
  auditId: Schema.String,
  ruleId: Schema.String,
  regenerate: Schema.Boolean,
})

/** Runs whose captures are read at once while the digest is assembled. */
const READ_CONCURRENCY = 8

/**
 * Steps 1 to 3 of the order of operations: the member, the audit and the failing finding in the
 * member's organization (another organization's id is a 404 before anything about AI is revealed),
 * then the organization's AI policy. The caller applies the policy gate.
 */
const authorize = (session: Parameters<typeof membership>[0], data: typeof FindingInput.Type) =>
  Effect.gen(function* () {
    const { organizationId: orgId, userId, role } = yield* membership(session)
    const auditId = yield* auditInOrg(orgId, data.auditId)
    const { db } = yield* Database
    const [found] = yield* db
      .select()
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
    if (found.kind !== "fail")
      return yield* new Invalid({ message: "Only a failing finding can be explained." })
    return { orgId, userId, role, auditId, finding: found, policy: yield* aiPolicyOf(orgId) }
  })

/**
 * The digest of a failing finding under the organization's disclosure policy, built from the
 * stored finding, its failing runs' check results, hit rows and stored captures, and the lookup
 * key it is cached under. The same stored input always gives the same evidence hash.
 */
const digestOf = (
  orgId: string,
  auditId: string,
  f: typeof finding.$inferSelect,
  includePagePaths: boolean,
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
      .where(and(eq(run.auditId, auditId), eq(run.orgId, orgId)))
      .orderBy(asc(run.ordinal))
    const pages = [...new Set(runs.map((r) => r.pageUrl))]
    const checks = yield* db
      .select({ runId: checkResult.runId, evidence: checkResult.evidence })
      .from(checkResult)
      .innerJoin(run, eq(run.id, checkResult.runId))
      .where(
        and(
          eq(run.auditId, auditId),
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
          eq(run.orgId, orgId),
          eq(checkResult.orgId, orgId),
          eq(checkResult.ruleId, f.ruleId),
          inArray(checkResult.status, ["pass", "fail"]),
        ),
      )
    const evidenceByRun = new Map<string, readonly EvidenceRef[]>()
    for (const check of checks)
      evidenceByRun.set(check.runId, yield* decodeEvidence(check.evidence).pipe(Effect.orDie))
    const failing = runs.filter((r) => evidenceByRun.has(r.id))
    const requestIds = new Set<string>()
    for (const refs of evidenceByRun.values())
      for (const ref of refs)
        if (ref.kind === "hit" || ref.kind === "request") requestIds.add(ref.requestId)
    const hitRows =
      failing.length === 0 || requestIds.size === 0
        ? []
        : yield* db
            .select()
            .from(hit)
            .where(
              and(
                eq(hit.orgId, orgId),
                inArray(
                  hit.runId,
                  failing.map((r) => r.id),
                ),
                inArray(hit.requestId, [...requestIds]),
              ),
            )
    const digestRuns = yield* Effect.forEach(
      failing,
      (r) =>
        Effect.gen(function* () {
          const capture = yield* readCapture(r.captureKey)
          const shape = yield* decodeShape(r).pipe(Effect.orDie)
          const hits: DecodedHit[] = []
          for (const row of hitRows) {
            const request = capture.requests.find((q) => q.id === row.requestId)
            if (row.runId !== r.id || request === undefined) continue
            hits.push({
              vendor: yield* decodeVendor(row.vendor).pipe(Effect.orDie),
              destinationId: row.destinationId,
              event: row.event,
              batchIndex: row.batchIndex,
              requestId: row.requestId,
              documentId: row.documentId,
              startedAt: request.startedAt,
              host: row.host,
              url: row.url,
              ...(yield* decodeHitColumns(row).pipe(Effect.orDie)),
            })
          }
          const index = pages.indexOf(r.pageUrl)
          return {
            page: { index, url: r.pageUrl, start: index === 0 },
            ...shape,
            journey: r.journey,
            capture,
            hits,
            evidence: evidenceByRun.get(r.id) ?? [],
          } satisfies DigestRun
        }),
      { concurrency: READ_CONCURRENCY },
    )
    const digest = buildDigest(
      {
        ruleId: f.ruleId,
        rulesVersions: f.rulesVersions,
        area: f.area,
        severity: yield* decodeSeverity(f.severity).pipe(Effect.orDie),
        title: f.title,
        why: f.why,
        fix: yield* decodeFix(f.fix).pipe(Effect.orDie),
        failingRuns: f.failingRuns,
        knownRuns: known?.n ?? 0,
      },
      digestRuns,
      { includePagePaths },
    )
    const hash = yield* Effect.promise(() => evidenceHash(digest))
    const key: LookupKey = {
      orgId,
      ruleId: digest.ruleId,
      rulesVersions: digest.rulesVersions.join(","),
      evidenceHash: hash,
      promptVersion: EXPLAIN_PROMPT_VERSION,
      policyId: digest.policyId,
    }
    return { digest, key }
  })

/** The configuration generation would use, or why there is none. Never fails for a missing key. */
const modelFor = (orgId: string) =>
  Effect.gen(function* () {
    const llm = yield* Llm
    return yield* llm.forOrganization(orgId).pipe(
      Effect.asSome,
      Effect.catchTags({
        LlmNotConfigured: () => Effect.succeed(Option.none<LlmModel>()),
        LlmError: () => Effect.succeed(Option.none<LlmModel>()),
      }),
    )
  })

const asExplanation = (row: CachedExplanation): Explanation => {
  const parsed = parseExplanation(JSON.stringify(row.explanation))
  if (parsed === null) throw new Error("a stored explanation no longer parses")
  return parsed
}

export type ExplainFailure =
  | "off"
  | "no-key"
  | "limit"
  | "in-flight"
  | "unreadable"
  | "timeout"
  | "provider"

export type ExplainResult =
  | {
      ok: true
      explanation: Explanation
      createdAt: Date
      cached: boolean
      provider: string
      model: string
    }
  | { ok: false; reason: ExplainFailure; message: string }

const failure = (reason: ExplainFailure, message: string): ExplainResult => ({
  ok: false,
  reason,
  message,
})

const answered = (row: CachedExplanation, cached: boolean): ExplainResult => ({
  ok: true,
  explanation: asExplanation(row),
  createdAt: row.createdAt,
  cached,
  provider: row.provider,
  model: row.model,
})

const MESSAGES = {
  off: "AI explanations are switched off for this organization.",
  noKey: "No API key is set for this organization. Add one in Settings > AI.",
  unreadableKey: "The saved API key could not be read. Enter it again in Settings > AI.",
  limit: "This organization has reached its hourly limit of AI explanations. Try again later.",
  inFlight: "An explanation for this finding is already being written. Check again in a moment.",
  unreadable: "The model's answer could not be used. Nothing was stored.",
  timeout: "The model did not answer in time.",
  provider: "The model provider returned an error.",
} as const

interface Generation {
  readonly key: LookupKey
  readonly keyHash: string
  readonly userId: string
  readonly digest: FindingDigest
  readonly model: LlmModel
  readonly regenerateSince: { readonly at: Date | null } | null
}

/**
 * Up to `MAX_ATTEMPTS` provider attempts for one call, all sharing a generation id. Each attempt
 * reserves first (cache re-check, single flight, hourly cap) and publishes fenced; nothing holds
 * the organization lock during the provider call.
 */
const generate = (input: Generation) =>
  Effect.gen(function* () {
    const generationId = crypto.randomUUID()
    const prompt = buildExplainPrompt(input.digest)
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const reservation = yield* reserve({
        key: input.key,
        keyHash: input.keyHash,
        userId: input.userId,
        generationId,
        identity: input.model.identity,
        regenerateSince: input.regenerateSince,
      })
      if (reservation.tag === "cached") return answered(reservation.row, true)
      if (reservation.tag === "in-flight") return failure("in-flight", MESSAGES.inFlight)
      if (reservation.tag === "limit") return failure("limit", MESSAGES.limit)
      const { usageId } = reservation
      const reply = yield* input.model.generateText(prompt).pipe(
        Effect.map((text) => ({ tag: "text" as const, text })),
        Effect.catchTags({
          LlmTimeout: () => Effect.succeed({ tag: "timeout" as const }),
          LlmError: () => Effect.succeed({ tag: "error" as const }),
        }),
      )
      if (reply.tag === "timeout") {
        yield* settle(usageId, "timeout")
        return failure("timeout", MESSAGES.timeout)
      }
      if (reply.tag === "error") {
        yield* settle(usageId, "provider_error")
        return failure("provider", MESSAGES.provider)
      }
      const explanation = parseExplanation(reply.text)
      if (explanation === null) {
        yield* settle(usageId, "unreadable")
        continue
      }
      const publication = yield* publish({
        key: input.key,
        keyHash: input.keyHash,
        usageId,
        identity: input.model.identity,
        explanation,
        userId: input.userId,
      })
      if (publication.tag === "published") return answered(publication.row, false)
      return publication.row === null
        ? failure("in-flight", MESSAGES.inFlight)
        : answered(publication.row, true)
    }
    return failure("unreadable", MESSAGES.unreadable)
  })

/**
 * An AI explanation of one failing finding. Order: membership, the audit and finding in the
 * organization (404), the role for Regenerate, the policy gate, the digest, the cache (any
 * configuration, no spend), and only then the organization's model and a reservation. Any member
 * may explain; only an owner or admin may regenerate. Returns `{ ok: true, value }` with an
 * `ExplainResult`, or `{ ok: false, message }` for a refusal (Regenerate by a member).
 */
export const explainFinding = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(ExplainInput))
  .handler(({ context, data }) =>
    respond(
      Effect.gen(function* () {
        const org = yield* authorize(context.session, data)
        if (data.regenerate && !isManager(org.role))
          return yield* new Forbidden({
            message: "Only organization owners and admins can regenerate an explanation.",
          })
        if (!org.policy.explanationsEnabled) return failure("off", MESSAGES.off)
        const { digest, key } = yield* digestOf(
          org.orgId,
          org.auditId,
          org.finding,
          org.policy.includePagePaths,
        )
        if (!data.regenerate) {
          const cached = yield* findCached(key)
          if (cached !== null) return answered(cached, true)
        }
        const model = yield* modelFor(org.orgId)
        if (Option.isNone(model)) return failure("no-key", MESSAGES.noKey)
        const keyHash = yield* keyHashOf(key)
        const previous = data.regenerate ? yield* cachedFor(key, model.value.identity) : null
        return yield* generate({
          key,
          keyHash,
          userId: org.userId,
          digest,
          model: model.value,
          regenerateSince: data.regenerate ? { at: previous?.createdAt ?? null } : null,
        })
      }),
    ),
  )
