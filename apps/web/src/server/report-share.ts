import { Database } from "@repo/core/Database"
import { generateShareToken, hashShareToken } from "@repo/core/share-token"
import { reportShare } from "@repo/db"
import { createServerFn } from "@tanstack/react-start"
import { getRequestUrl } from "@tanstack/react-start/server"
import { and, eq, isNull } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { auditInOrg } from "./audit-data"
import { publishReportData } from "./report-publish-data"
import { shareInOrg, sharesOf } from "./report-share-data"
import { requireSession } from "./require-session"
import { Invalid, membership, mutation, read } from "./server-fn"

const LABEL_MAX = 80
const DAY_MS = 24 * 60 * 60 * 1000

const CreateInput = Schema.Struct({
  auditId: Schema.String,
  label: Schema.optional(Schema.String),
  expiresInDays: Schema.NullOr(Schema.Literals([7, 30, 90])),
})

/**
 * Publishes the report (reusing the latest version when nothing changed) and adds a link to it.
 * The token is returned here and nowhere else: only its hash is stored. Any member may share.
 */
export const createShareLink = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(CreateInput))
  .handler(({ context, data }) =>
    mutation(
      Effect.gen(function* () {
        const { organizationId, userId } = yield* membership(context.session)
        const auditId = yield* auditInOrg(organizationId, data.auditId)
        const label = data.label?.trim() ?? ""
        if (label.length > LABEL_MAX)
          return yield* new Invalid({ message: `A label can be at most ${LABEL_MAX} characters.` })
        const published = yield* publishReportData(organizationId, userId, auditId)
        const token = generateShareToken()
        const tokenHash = yield* Effect.promise(() => hashShareToken(token))
        const { db } = yield* Database
        yield* db.insert(reportShare).values({
          orgId: organizationId,
          snapshotId: published.snapshotId,
          tokenHash,
          label: label === "" ? null : label,
          expiresAt:
            data.expiresInDays === null ? null : new Date(Date.now() + data.expiresInDays * DAY_MS),
          createdBy: userId,
        })
        return {
          url: `${getRequestUrl().origin}/r/${token}`,
          version: published.version,
          reused: published.reused,
        }
      }),
    ),
  )

/** The audit's versions with their links: status, opened count, last opened, who created it. No token. */
export const listShares = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ auditId: Schema.String })))
  .handler(({ context, data }) =>
    read(
      Effect.gen(function* () {
        const { organizationId, userId, role } = yield* membership(context.session)
        return yield* sharesOf(organizationId, userId, role, data.auditId)
      }),
    ),
  )

/** Turns a link off at once. Revoking twice changes nothing. */
export const revokeShare = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ shareId: Schema.String })))
  .handler(({ context, data }) =>
    mutation(
      Effect.gen(function* () {
        const { organizationId, userId } = yield* membership(context.session)
        const id = yield* shareInOrg(organizationId, data.shareId)
        const { db } = yield* Database
        yield* db
          .update(reportShare)
          .set({ revokedAt: new Date(), revokedBy: userId })
          .where(
            and(
              eq(reportShare.id, id),
              eq(reportShare.orgId, organizationId),
              isNull(reportShare.revokedAt),
            ),
          )
        return null
      }),
    ),
  )
