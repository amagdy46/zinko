import { Storage } from "@repo/core"
import { Database } from "@repo/core/Database"
import { hashShareToken, looksLikeShareToken } from "@repo/core/share-token"
import { reportShare, reportSnapshot } from "@repo/db"
import { and, desc, eq, gt, sql } from "drizzle-orm"
import { Effect, Option, Predicate, Result } from "effect"
import { renderNoticePage, renderReportPage } from "@/components/report/public-page"
import { decodeStoredReportModel } from "@/lib/report-model"
import appCss from "@/styles.css?url"
import { statusOf } from "./report-share-data"
import type { WorkerRoute } from "./routes"
import { runtime } from "./runtime"

const prefix = "/r/"

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'self'; img-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
}

/** Every response of this route, success or failure, goes through here so the headers cannot differ. */
const reportResponse = (
  status: number,
  body: BodyInit | null,
  extra: Record<string, string> = {},
) => new Response(body, { status, headers: { ...SECURITY_HEADERS, ...extra } })

const HTML = { "Content-Type": "text/html; charset=utf-8" }

const page = (status: number, heading: string, agency: string | null = null) =>
  reportResponse(status, renderNoticePage({ stylesheet: appCss, heading, agency }), HTML)

/** The snapshot exists but cannot be shown: never a 500, and the page names only the agency. */
const unavailable = (agency: string | null) =>
  page(503, "This report cannot be shown right now.", agency)

const notFound = () => page(404, "This report was not found.")

/**
 * Finds the link by the hash of its token, compares the stored hash as defence in depth, and says
 * what state it is in. One indexed read; the model is not selected.
 */
const lookup = (token: string) =>
  Effect.gen(function* () {
    const hash = yield* Effect.promise(() => hashShareToken(token))
    const { db } = yield* Database
    const [found] = yield* db
      .select({
        id: reportShare.id,
        tokenHash: reportShare.tokenHash,
        revokedAt: reportShare.revokedAt,
        expiresAt: reportShare.expiresAt,
        snapshotId: reportShare.snapshotId,
        auditId: reportSnapshot.auditId,
        version: reportSnapshot.version,
        publishedAt: reportSnapshot.publishedAt,
        logoKey: reportSnapshot.logoKey,
        logoType: reportSnapshot.logoType,
        agency: sql<string>`${reportSnapshot.model} -> 'branding' ->> 'agencyName'`,
      })
      .from(reportShare)
      .innerJoin(reportSnapshot, eq(reportSnapshot.id, reportShare.snapshotId))
      .where(eq(reportShare.tokenHash, hash))
      .limit(1)
    if (found === undefined || !sameHash(found.tokenHash, hash)) return Option.none()
    return Option.some({ ...found, state: statusOf(found, new Date()) })
  })

type Link = Option.Option.Value<Effect.Success<ReturnType<typeof lookup>>>

/** Constant time over two equal-length hex strings; the indexed equality is the real gate. */
const sameHash = (stored: string, computed: string) => {
  let diff = stored.length ^ computed.length
  for (let i = 0; i < computed.length; i++)
    diff |= (stored.codePointAt(i) ?? 0) ^ (computed.codePointAt(i) ?? 0)
  return diff === 0
}

const document = (token: string, link: Link) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const [snapshot] = yield* db
      .select({ model: reportSnapshot.model, modelVersion: reportSnapshot.modelVersion })
      .from(reportSnapshot)
      .where(eq(reportSnapshot.id, link.snapshotId))
      .limit(1)
    if (snapshot === undefined) return notFound()
    const decoded = yield* decodeStoredReportModel(snapshot.modelVersion, snapshot.model).pipe(
      Effect.result,
    )
    if (Result.isFailure(decoded)) {
      // Names the cause and the stored version, never the content; the page names only the agency.
      yield* Effect.logError(
        `Report snapshot ${link.snapshotId} (model version ${snapshot.modelVersion}) cannot be rendered: ${Predicate.isTagged(decoded.failure, "UnknownModelVersion") ? "unknown model version" : "does not match the model"}`,
      )
      return unavailable(link.agency)
    }
    const model = decoded.success
    const [newer] = yield* db
      .select({ publishedAt: reportSnapshot.publishedAt })
      .from(reportSnapshot)
      .where(
        and(eq(reportSnapshot.auditId, link.auditId), gt(reportSnapshot.version, link.version)),
      )
      .orderBy(desc(reportSnapshot.version))
      .limit(1)
    // link-preview bots open links too: the count says "opened", and moves at most once a minute
    yield* db
      .update(reportShare)
      .set({ viewCount: sql`${reportShare.viewCount} + 1`, lastViewedAt: sql`now()` })
      .where(
        and(
          eq(reportShare.id, link.id),
          sql`(${reportShare.lastViewedAt} is null or ${reportShare.lastViewedAt} < now() - interval '1 minute')`,
        ),
      )
    return reportResponse(
      200,
      renderReportPage({
        model,
        stylesheet: appCss,
        logoSrc: link.logoKey === null ? null : `/r/${token}/logo`,
        version: link.version,
        publishedAt: link.publishedAt.toISOString(),
        newerPublishedAt: newer?.publishedAt.toISOString() ?? null,
      }),
      HTML,
    )
  })

const logo = (link: Link) =>
  Effect.gen(function* () {
    if (link.logoKey === null || link.logoType === null) return notFound()
    const storage = yield* Storage
    const file = yield* storage.get(link.logoKey)
    if (Option.isNone(file)) return notFound()
    return reportResponse(200, file.value.body, {
      "Content-Type": link.logoType,
      "Content-Disposition": "inline",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    })
  })

const ended = (state: "revoked" | "expired", agency: string) =>
  page(
    410,
    state === "revoked" ? "This report link has been turned off." : "This report link has expired.",
    agency,
  )

export const reportRouteMeta = { path: "/r/*", methods: ["GET"], access: "read" } as const

/**
 * The public report, under `/r/`: `GET /r/<token>` is the document, `GET /r/<token>/logo` its logo.
 * A malformed token never reaches the database, and an unknown token, a deleted version and a
 * wrong path all give the same 404. A revoked or expired link gives 410 and shows only the
 * agency's name. Both URLs look the link up on every request and nothing is cacheable, so a
 * revocation reaches the logo as well.
 */
export const reportRoute: WorkerRoute = async (request) => {
  const { pathname } = new URL(request.url)
  if (pathname !== "/r" && !pathname.startsWith(prefix)) return undefined
  if (request.method !== "GET") return reportResponse(405, null, { Allow: "GET" })
  const [token = "", logoPath, ...rest] = pathname.slice(prefix.length).split("/")
  if (rest.length > 0 || (logoPath !== undefined && logoPath !== "logo")) return notFound()
  if (!looksLikeShareToken(token)) return notFound()
  return runtime
    .runPromise(
      Effect.gen(function* () {
        const found = yield* lookup(token)
        if (Option.isNone(found)) return notFound()
        const link = found.value
        if (link.state !== "active") return ended(link.state, link.agency)
        return logoPath === undefined ? yield* document(token, link) : yield* logo(link)
      }).pipe(Effect.orElseSucceed(() => unavailable(null))),
    )
    .catch((error: unknown) => {
      console.error("Report unavailable:", error)
      return unavailable(null)
    })
}
