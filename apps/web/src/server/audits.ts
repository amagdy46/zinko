import { CaptureResult, MAX_URL_LENGTH } from "@repo/capture-contract"
import { AuditConfig, Jobs, Storage, TEST_CLICK_IDS } from "@repo/core"
import { Database } from "@repo/core/Database"
import { audit, run, site, client, finding, findingTriage, checkResult } from "@repo/db"
import { createServerFn } from "@tanstack/react-start"
import { and, asc, count, eq, countDistinct } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"
import { isPrivateHost } from "@repo/capture-contract"
import {
  canonicalHost,
  hasCredentials,
  isOnSite,
  originHost,
  withoutCredentials,
} from "@/lib/site-url"
import { triageJoin } from "./findings-data"
import { requireSession } from "./require-session"
import {
  allowPrivateSites,
  atomically,
  Invalid,
  isUuid,
  membership,
  NotFound,
  read,
  respond,
  siteInOrg,
} from "./server-fn"

/** Long enough for one page load; the audit page refetches every 4 minutes while it is open. */
const SCREENSHOT_URL_SECONDS = 5 * 60

const SEVERITIES = ["critical", "warning", "info"] as const

const RunErrors = Schema.Array(Schema.Struct({ code: Schema.String, message: Schema.String }))
const decodeConsent = Schema.decodeUnknownOption(CaptureResult.fields.consent)
const decodeRunErrors = Schema.decodeUnknownOption(RunErrors)

/**
 * The pages as `URL` writes them, each once: `http://LOCALHOST:4400/a` and `http://localhost:4400/a`
 * are one page. Every page must be on the site.
 */
const normalizePages = (pages: ReadonlyArray<string>, target: { host: string; origin: string }) =>
  Effect.gen(function* () {
    const hrefs: string[] = []
    for (const page of pages) {
      if (hasCredentials(page))
        return yield* new Invalid({
          message: `${withoutCredentials(page)} is refused: URLs must not contain a username or password.`,
        })
      if (!isOnSite(page, target))
        return yield* new Invalid({ message: `${page} is not on ${originHost(target.origin)}.` })
      const { href } = new URL(page)
      if (!hrefs.includes(href)) hrefs.push(href)
    }
    return hrefs
  })

const PREFLIGHT_TIMEOUT_MS = 8_000
const PREFLIGHT_MAX_REDIRECTS = 5

/**
 * Loads the start page once before an audit is created, so a dead address is reported on the form
 * instead of as a full audit of failed runs. Redirects are followed by hand: every hop must stay on
 * the site (same host rules and port as the pages) and, outside local dev, on a public host. A 404,
 * 410 or 5xx answer is refused; 401, 403 and 429 are left to the capture, which names bot blocks.
 * Messages start with the URL as typed so the form can show them under that field.
 */
const preflight = (typed: string, start: string, target: { host: string; origin: string }) =>
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
                : `${typed} could not be reached. Check the address and that the site is up.`,
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

/** The URL each page is captured at: the test click IDs go on the start URL only. */
const captureUrls = (pages: ReadonlyArray<string>, clickIds: boolean) =>
  Effect.forEach(pages, (page, index) => {
    const url = new URL(page)
    if (index === 0 && clickIds)
      for (const [name, value] of Object.entries(TEST_CLICK_IDS)) url.searchParams.set(name, value)
    return url.href.length <= MAX_URL_LENGTH
      ? Effect.succeed(url.href)
      : Effect.fail(new Invalid({ message: `${page} is too long.` }))
  })

/**
 * Creates an audit of a site and starts its workflow. The audit and its runs (page × scenario ×
 * viewport, in that order, then with `journey` one journey run per scenario × viewport, when there
 * is a key page to walk to) are inserted together; the workflow instance is named by the audit
 * id, so the audit cannot be started twice. If the start fails, the audit is saved `failed` with
 * the reason and its id is still returned.
 */
export const startAudit = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(
    Schema.toStandardSchemaV1(Schema.Struct({ siteId: Schema.String, config: AuditConfig })),
  )
  .handler(({ context, data }) =>
    respond(
      Effect.gen(function* () {
        const { organizationId: orgId, userId } = yield* membership(context.session)
        const { db } = yield* Database
        const checked = yield* siteInOrg(orgId, data.siteId)
        if (checked.archivedAt !== null)
          return yield* new Invalid({ message: "This site is archived." })
        const [typedStart] = data.config.pages
        const [normalizedStart] = yield* normalizePages(data.config.pages, checked)
        if (typedStart !== undefined && normalizedStart !== undefined)
          yield* preflight(typedStart, normalizedStart, checked)
        const auditId = yield* atomically(
          Effect.gen(function* () {
            const target = yield* siteInOrg(orgId, data.siteId, true)
            if (target.archivedAt !== null)
              return yield* new Invalid({ message: "This site is archived." })
            const pages = yield* normalizePages(data.config.pages, target)
            const config = { ...data.config, pages }
            const urls = yield* captureUrls(pages, config.clickIds)
            const [created] = yield* db
              .insert(audit)
              .values({ orgId, siteId: target.id, createdBy: userId, config, status: "queued" })
              .returning({ id: audit.id })
            if (created === undefined) return yield* new NotFound({ message: "Not found" })
            const { scenarios, viewports } = config
            // a journey run captures at the start URL and walks the key pages from there
            const [startUrl] = urls
            const runPages = [
              ...urls.map((pageUrl) => ({ pageUrl, journey: false })),
              ...(config.journey === true && urls.length > 1 && startUrl !== undefined
                ? [{ pageUrl: startUrl, journey: true }]
                : []),
            ]
            const runs = runPages.flatMap(({ pageUrl, journey }, p) =>
              scenarios.flatMap((scenario, s) =>
                viewports.map((viewport, v) => ({
                  orgId,
                  auditId: created.id,
                  ordinal: (p * scenarios.length + s) * viewports.length + v,
                  pageUrl,
                  journey,
                  scenario,
                  viewport,
                  status: "pending",
                })),
              ),
            )
            yield* db.insert(run).values(runs)
            return created.id
          }),
        )
        const jobs = yield* Jobs
        yield* jobs.start("audit", { auditId }, { id: auditId }).pipe(
          Effect.flatMap((instance) =>
            db.update(audit).set({ workflowId: instance.id }).where(eq(audit.id, auditId)),
          ),
          Effect.catchTag("JobError", (error) =>
            Effect.gen(function* () {
              // the call can fail (a timeout) after the instance was created; then it runs
              const created = yield* jobs.status("audit", auditId).pipe(Effect.option)
              if (Option.isSome(created))
                return yield* db
                  .update(audit)
                  .set({ workflowId: auditId })
                  .where(eq(audit.id, auditId))
              yield* Effect.logError("Audit workflow did not start", error)
              return yield* db
                .update(audit)
                .set({
                  status: "failed",
                  error: "The audit could not be started. Try again.",
                  finishedAt: new Date(),
                })
                .where(eq(audit.id, auditId))
            }),
          ),
        )
        return { auditId }
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
            site: { id: site.id, name: site.name, host: site.host },
            client: { id: client.id, name: client.name },
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
        const failingChecks = yield* db
          .select({ runId: checkResult.runId, severity: checkResult.severity, n: count() })
          .from(checkResult)
          .innerJoin(run, eq(run.id, checkResult.runId))
          .where(
            and(
              eq(run.auditId, found.audit.id),
              eq(run.orgId, orgId),
              eq(checkResult.orgId, orgId),
              eq(checkResult.status, "fail"),
            ),
          )
          .groupBy(checkResult.runId, checkResult.severity)
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
        const findings = yield* db
          .select({
            ruleId: finding.ruleId,
            title: finding.title,
            kind: finding.kind,
            severity: finding.severity,
            runIds: finding.runIds,
            triage: findingTriage.status,
          })
          .from(finding)
          .leftJoin(findingTriage, triageJoin)
          .where(and(eq(finding.auditId, found.audit.id), eq(finding.orgId, orgId)))
        const [evaluation] = yield* db
          .select({ total: countDistinct(checkResult.runId) })
          .from(checkResult)
          .innerJoin(run, eq(run.id, checkResult.runId))
          .where(
            and(
              eq(run.auditId, found.audit.id),
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
          hits: runs.reduce((total, row) => total + row.hitCount, 0),
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
            config,
          },
          site: found.site,
          client: found.client,
          summary,
          findings: findings.filter((f) => f.kind === "fail"),
          runs,
        }
      }),
    ),
  )
