import { CaptureResult } from "@repo/capture-contract"
import { AuditConfig, Storage } from "@repo/core"
import { Database } from "@repo/core/Database"
import { audit, run, site, client, checkResult } from "@repo/db"
import { createServerFn } from "@tanstack/react-start"
import { and, asc, eq, countDistinct, sql } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"
import { isPrivateHost } from "@repo/capture-contract"
import { canonicalHost, isOnSite, originHost } from "@/lib/site-url"
import {
  carryOverOf,
  createAudit,
  evaluatedAudit,
  launchAudit,
  normalizePages,
  rerunBaseline,
} from "./audit-create"
import { findingRowsOf } from "./findings-data"
import { ruleTitleOf } from "./recheck-data"
import { requireSession } from "./require-session"
import {
  allowPrivateSites,
  atomically,
  Invalid,
  isUuid,
  membership,
  NotFound,
  read,
  mutation,
  siteInOrg,
} from "./server-fn"

/** Long enough for one page load; the audit page refetches every 4 minutes while it is open. */
const SCREENSHOT_URL_SECONDS = 5 * 60

const SEVERITIES = ["critical", "warning", "info"] as const

const RunErrors = Schema.Array(Schema.Struct({ code: Schema.String, message: Schema.String }))
const decodeConsent = Schema.decodeUnknownOption(CaptureResult.fields.consent)
const decodeRunErrors = Schema.decodeUnknownOption(RunErrors)

const PREFLIGHT_TIMEOUT_MS = 8_000
const PREFLIGHT_MAX_REDIRECTS = 5

/**
 * Loads the start page once before an audit is created, so a dead address is reported on the form
 * instead of as a full audit of failed runs. Redirects are followed by hand: every hop must stay on
 * the site (same host rules and port as the pages) and, outside local dev, on a public host. A 404,
 * 410 or 5xx answer is refused; 401, 403 and 429 are left to the capture, which names bot blocks.
 * Messages start with the URL as typed so the form can show them under that field.
 */
const preflight = (
  typed: string,
  start: string,
  target: { host: string; origin: string; measuredHosts?: ReadonlyArray<string> },
) =>
  Effect.gen(function* () {
    const allowPrivate = yield* allowPrivateSites
    let url = start
    for (let hop = 0; hop <= PREFLIGHT_MAX_REDIRECTS; hop++) {
      const host = canonicalHost(url) ?? ""
      if (isPrivateHost(host) && !allowPrivate)
        return yield* new Invalid({
          message: `${typed} is a private address and cannot be audited.`,
        })
      const response = yield* Effect.tryPromise({
        try: (signal) =>
          fetch(url, {
            redirect: "manual",
            headers: { accept: "text/html" },
            signal: AbortSignal.any([signal, AbortSignal.timeout(PREFLIGHT_TIMEOUT_MS)]),
          }),
        catch: (cause) =>
          new Invalid({
            message:
              cause instanceof DOMException && cause.name === "TimeoutError"
                ? `${typed} did not answer within ${PREFLIGHT_TIMEOUT_MS / 1000} seconds. Check that the site is up.`
                : `${typed} could not be reached. Check the address and that the site is up.${typed.startsWith("https:") ? " If it only serves http, change the site address to http://." : ""}`,
          }),
      })
      yield* Effect.promise(() => response.body?.cancel() ?? Promise.resolve())
      const location = response.headers.get("location")
      if (response.status >= 300 && response.status < 400 && location !== null) {
        const next = URL.canParse(location, url) ? new URL(location, url).href : undefined
        if (next === undefined || !isOnSite(next, target))
          return yield* new Invalid({
            message: `${typed} redirects to another site (${next === undefined ? location : originHost(next)}). Start from the page that stays on ${originHost(target.origin)}.`,
          })
        url = next
        continue
      }
      if (response.status === 404 || response.status === 410 || response.status >= 500)
        return yield* new Invalid({
          message: `${typed} returned ${response.status}${response.statusText === "" ? "" : ` (${response.statusText})`}. Use a page that loads.`,
        })
      return undefined
    }
    return yield* new Invalid({ message: `${typed} redirects too many times.` })
  })

/**
 * Creates an audit of a site and starts its workflow (see `createAudit`). The new audit is
 * compared with the site's latest evaluated full audit. If the start fails, the audit is saved
 * `failed` with the reason and its id is still returned.
 */
export const startAudit = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(
    Schema.toStandardSchemaV1(Schema.Struct({ siteId: Schema.String, config: AuditConfig })),
  )
  .handler(({ context, data }) =>
    mutation(
      Effect.gen(function* () {
        const { organizationId: orgId, userId } = yield* membership(context.session)
        const checked = yield* siteInOrg(orgId, data.siteId)
        if (checked.archivedAt !== null)
          return yield* new Invalid({ message: "This site is archived." })
        const [typedStart] = data.config.pages
        const [normalizedStart] = yield* normalizePages(data.config.pages, checked)
        if (typedStart !== undefined && normalizedStart !== undefined)
          yield* preflight(typedStart, normalizedStart, checked)
        const auditId = yield* createAudit({
          orgId,
          userId,
          siteId: checked.id,
          config: data.config,
          origin: { kind: "new" },
        })
        yield* launchAudit(auditId)
        return { auditId }
      }),
    ),
  )

/** The stored audit a re-run copies: settled, a full audit, on a site that is not archived. */
const rerunnable = (orgId: string, id: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    if (!isUuid(id)) return yield* new NotFound({ message: "Not found" })
    const [found] = yield* db
      .select({
        siteId: audit.siteId,
        status: audit.status,
        kind: audit.kind,
        config: audit.config,
      })
      .from(audit)
      .where(and(eq(audit.id, id), eq(audit.orgId, orgId)))
      .limit(1)
    if (found === undefined) return yield* new NotFound({ message: "Not found" })
    const target = yield* siteInOrg(orgId, found.siteId)
    const config = yield* Schema.decodeUnknownEffect(AuditConfig)(found.config).pipe(Effect.orDie)
    let unavailable: string | null = null
    if (found.status !== "complete" && found.status !== "partial")
      unavailable = "Wait for this audit to finish before re-running it."
    if (target.archivedAt !== null) unavailable = "This site is archived."
    if (found.kind !== "full") unavailable = "A re-check cannot be re-run."
    return { target, config, unavailable }
  })

/**
 * What a re-run of an audit would do, read-only: its stored settings, the audit it would be
 * compared with and why it is unavailable, if it is.
 */
export const previewRerun = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ auditId: Schema.String })))
  .handler(({ context, data }) =>
    read(
      Effect.gen(function* () {
        const { organizationId: orgId } = yield* membership(context.session)
        const { target, config, unavailable } = yield* rerunnable(orgId, data.auditId)
        const baseline = Option.getOrNull(yield* rerunBaseline(orgId, target.id, data.auditId))
        return {
          config,
          unavailable,
          baseline,
          carryOver: baseline === null ? null : yield* carryOverOf(orgId, baseline.id),
        }
      }),
    ),
  )

/**
 * Re-runs an audit with its stored settings, compared with it. The config is read from the stored
 * audit and validated again; the client sends only the audit id.
 */
export const rerunAudit = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ auditId: Schema.String })))
  .handler(({ context, data }) =>
    mutation(
      Effect.gen(function* () {
        const { organizationId: orgId, userId } = yield* membership(context.session)
        const { target, config, unavailable } = yield* rerunnable(orgId, data.auditId)
        if (unavailable !== null) return yield* new Invalid({ message: unavailable })
        const [typedStart] = config.pages
        const [normalizedStart] = yield* normalizePages(config.pages, target)
        if (typedStart !== undefined && normalizedStart !== undefined)
          yield* preflight(typedStart, normalizedStart, target)
        const auditId = yield* createAudit({
          orgId,
          userId,
          siteId: target.id,
          config,
          origin: { kind: "rerun", auditId: data.auditId },
        })
        yield* launchAudit(auditId)
        return { auditId }
      }),
    ),
  )

/**
 * Makes `against` the audit's comparison baseline: an earlier evaluated full audit of the same
 * site. Refused while the audit is queued or running, so the link cannot be moved around the
 * one-re-run-per-baseline guard. The audit row is locked, the baseline row is held against a delete.
 */
export const setBaseline = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(
    Schema.toStandardSchemaV1(Schema.Struct({ auditId: Schema.String, against: Schema.String })),
  )
  .handler(({ context, data }) =>
    mutation(
      Effect.gen(function* () {
        const { organizationId: orgId } = yield* membership(context.session)
        const { db } = yield* Database
        if (!isUuid(data.auditId) || !isUuid(data.against))
          return yield* new NotFound({ message: "Not found" })
        yield* atomically(
          Effect.gen(function* () {
            const [mine] = yield* db
              .select({
                siteId: audit.siteId,
                status: audit.status,
                kind: audit.kind,
                createdAt: audit.createdAt,
              })
              .from(audit)
              .where(and(eq(audit.id, data.auditId), eq(audit.orgId, orgId)))
              .limit(1)
              .for("update")
            if (mine === undefined) return yield* new NotFound({ message: "Not found" })
            if (mine.kind !== "full")
              return yield* new Invalid({ message: "A re-check has no baseline." })
            if (mine.status === "queued" || mine.status === "running")
              return yield* new Invalid({
                message: "Wait for this audit to finish before changing its baseline.",
              })
            const [other] = yield* db
              .select({
                id: audit.id,
                valid: sql<boolean>`${audit.kind} = 'full' and ${audit.status} in ('complete', 'partial') and ${audit.createdAt} < ${mine.createdAt} and ${evaluatedAudit(orgId)}`,
              })
              .from(audit)
              .where(
                and(
                  eq(audit.id, data.against),
                  eq(audit.orgId, orgId),
                  eq(audit.siteId, mine.siteId),
                ),
              )
              .limit(1)
              .for("key share")
            if (other === undefined) return yield* new NotFound({ message: "Not found" })
            // a newer, narrow or unevaluated audit is as absent as another site's: one answer, a 404
            if (!other.valid) return yield* new NotFound({ message: "Not found" })
            yield* db
              .update(audit)
              .set({ baselineAuditId: other.id })
              .where(and(eq(audit.id, data.auditId), eq(audit.orgId, orgId)))
            return undefined
          }),
        )
        return { auditId: data.auditId }
      }),
    ),
  )

/**
 * An audit of the session's organization with its runs in order. Screenshot URLs are signed for
 * 5 minutes. Another organization's audit is a 404, like a missing one.
 */
export const getAudit = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ id: Schema.String })))
  .handler(({ context, data }) =>
    read(
      Effect.gen(function* () {
        const { organizationId: orgId } = yield* membership(context.session)
        if (!isUuid(data.id)) return yield* new NotFound({ message: "Not found" })
        const { db } = yield* Database
        const [found] = yield* db
          .select({
            audit,
            site: { id: site.id, name: site.name, host: site.host, archivedAt: site.archivedAt },
            client: { id: client.id, name: client.name, isDefault: client.isDefault },
          })
          .from(audit)
          .innerJoin(site, eq(site.id, audit.siteId))
          .innerJoin(client, eq(client.id, site.clientId))
          .where(and(eq(audit.id, data.id), eq(audit.orgId, orgId)))
          .limit(1)
        if (found === undefined) return yield* new NotFound({ message: "Not found" })
        const config = yield* Schema.decodeUnknownEffect(AuditConfig)(found.audit.config).pipe(
          Effect.orDie,
        )
        const rows = yield* db
          .select()
          .from(run)
          .where(and(eq(run.auditId, found.audit.id), eq(run.orgId, orgId)))
          .orderBy(asc(run.ordinal))
        const storage = yield* Storage
        const failingOnTargets = yield* db
          .select({
            runId: checkResult.runId,
            ruleId: checkResult.ruleId,
            title: checkResult.title,
            severity: checkResult.severity,
          })
          .from(checkResult)
          .innerJoin(run, eq(run.id, checkResult.runId))
          .where(
            and(
              eq(run.auditId, found.audit.id),
              eq(run.role, "target"),
              eq(run.orgId, orgId),
              eq(checkResult.orgId, orgId),
              eq(checkResult.status, "fail"),
            ),
          )
        // A re-check answers about one check: its runs count that check's failures only, and the
        // other checks that failed on the same runs are listed apart.
        const narrowRule = found.audit.narrowRuleId
        const failingChecks = failingOnTargets
          .filter((c) => narrowRule === null || c.ruleId === narrowRule)
          .map((c) => ({ runId: c.runId, severity: c.severity, n: 1 }))
        const others = new Map<string, { ruleId: string; title: string; runs: number }>()
        for (const c of failingOnTargets) {
          if (narrowRule === null || c.ruleId === narrowRule) continue
          const seen = others.get(c.ruleId)
          if (seen === undefined)
            others.set(c.ruleId, { ruleId: c.ruleId, title: c.title, runs: 1 })
          else seen.runs += 1
        }
        const otherFailing = [...others.values()]
        const failingOf = (runId: string) => {
          const own = failingChecks.filter((c) => c.runId === runId)
          const worst = SEVERITIES.find((s) => own.some((c) => c.severity === s))
          return worst === undefined
            ? null
            : { severity: worst, count: own.reduce((total, c) => total + c.n, 0) }
        }
        const runs = yield* Effect.forEach(rows, (r) =>
          Effect.gen(function* () {
            const screenshotUrl =
              r.screenshotKey === null
                ? null
                : yield* storage
                    .signedUrl(r.screenshotKey, { expiresInSeconds: SCREENSHOT_URL_SECONDS })
                    .pipe(Effect.orDie)
            return {
              id: r.id,
              ordinal: r.ordinal,
              pageUrl: r.pageUrl,
              scenario: r.scenario,
              viewport: r.viewport,
              journey: r.journey,
              followHost: r.followHost,
              role: r.role,
              status: r.status,
              failure: r.failure,
              errors: Option.getOrElse(decodeRunErrors(r.errors), () => []),
              consentOutcome: Option.getOrNull(
                Option.map(decodeConsent(r.consent), (consent) => consent.outcome),
              ),
              hitCount: r.hitCount,
              failing: failingOf(r.id),
              complete: r.complete,
              truncated: r.truncated,
              screenshotUrl,
              startedAt: r.startedAt,
              finishedAt: r.finishedAt,
            }
          }),
        )
        const findings = (yield* findingRowsOf(orgId, found.audit.id)).map((row) => ({
          ruleId: row.finding.ruleId,
          title: row.finding.title,
          kind: row.finding.kind,
          severity: row.finding.severity,
          runIds: row.finding.runIds,
          triage: row.triage?.status ?? null,
        }))
        const [evaluation] = yield* db
          .select({ total: countDistinct(checkResult.runId) })
          .from(checkResult)
          .innerJoin(run, eq(run.id, checkResult.runId))
          .where(
            and(
              eq(run.auditId, found.audit.id),
              eq(run.role, "target"),
              eq(run.orgId, orgId),
              eq(checkResult.orgId, orgId),
            ),
          )
        const openCount = (severity: string) =>
          findings.filter(
            (f) =>
              f.kind === "fail" &&
              f.severity === severity &&
              (f.triage === null || f.triage === "open"),
          ).length
        const summary = {
          hits: runs
            .filter((row) => row.role === "target")
            .reduce((total, row) => total + row.hitCount, 0),
          findings: {
            critical: findings.filter((f) => f.kind === "fail" && f.severity === "critical").length,
            warning: findings.filter((f) => f.kind === "fail" && f.severity === "warning").length,
            info: findings.filter((f) => f.kind === "fail" && f.severity === "info").length,
            couldNotCheck: findings.filter((f) => f.kind === "inconclusive").length,
          },
          open: {
            critical: openCount("critical"),
            warning: openCount("warning"),
            info: openCount("info"),
          },
          evaluatedRuns: evaluation?.total ?? 0,
          otherFailing,
        }
        const { audit: a } = found
        return {
          audit: {
            id: a.id,
            status: a.status,
            error: a.error,
            createdAt: a.createdAt,
            startedAt: a.startedAt,
            finishedAt: a.finishedAt,
            kind: a.kind,
            recheckTitle:
              a.kind === "narrow" && a.narrowRuleId !== null
                ? yield* ruleTitleOf(orgId, a.id, a.narrowRuleId)
                : null,
            config,
          },
          site: {
            id: found.site.id,
            name: found.site.name,
            host: found.site.host,
            archived: found.site.archivedAt !== null,
          },
          client: found.client.isDefault ? null : { id: found.client.id, name: found.client.name },
          summary,
          findings: findings.filter((f) => f.kind === "fail"),
          runs,
        }
      }),
    ),
  )
