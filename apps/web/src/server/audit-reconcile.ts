import { createServerFn } from "@tanstack/react-start"
import { Effect, Schema } from "effect"
import { auditInOrg } from "./audit-data"
import { reconcileActive } from "./audit-reconcile-data"
import { requireSession } from "./require-session"
import { membership, mutation } from "./server-fn"

/**
 * Reconciles the organization's active audits when the caller opened one that has been active for a
 * while. The audit is checked against the organization first, before any `Jobs` call; another
 * organization's id, a missing id and a removed member's id answer the same 404.
 */
export const reconcileAudit = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ auditId: Schema.String })))
  .handler(({ context, data }) =>
    mutation(
      Effect.gen(function* () {
        const { organizationId: orgId } = yield* membership(context.session)
        const auditId = yield* auditInOrg(orgId, data.auditId)
        const outcomes = yield* reconcileActive(orgId)
        return { settled: outcomes.get(auditId) === "settled" }
      }),
    ),
  )
