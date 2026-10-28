import { createServerFn } from "@tanstack/react-start"
import { Effect, Schema } from "effect"
import { auditInOrg } from "./audit-data"
import { deleteSnapshotData, publishReportData } from "./report-publish-data"
import { requireSession } from "./require-session"
import { membership, respond } from "./server-fn"

/**
 * Freezes the report as a new version, or answers with the latest one when nothing changed. Any
 * member of the audit's organization may publish.
 */
export const publishReport = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ auditId: Schema.String })))
  .handler(({ context, data }) =>
    respond(
      Effect.gen(function* () {
        const { organizationId, userId } = yield* membership(context.session)
        const auditId = yield* auditInOrg(organizationId, data.auditId)
        return yield* publishReportData(organizationId, userId, auditId)
      }),
    ),
  )

/** Deletes a published version, its links and its logo copy: owners, admins and the publisher. */
export const deleteSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ snapshotId: Schema.String })))
  .handler(({ context, data }) =>
    respond(
      Effect.gen(function* () {
        const { organizationId, userId, role } = yield* membership(context.session)
        return yield* deleteSnapshotData(organizationId, userId, role, data.snapshotId)
      }),
    ),
  )
