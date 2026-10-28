import { createServerFn } from "@tanstack/react-start"
import { Effect, Schema } from "effect"
import { comparisonOf, tagDiffOf } from "./compare-data"
import { requireSession } from "./require-session"
import { membership, read } from "./server-fn"

/**
 * The comparison of an audit with an earlier one of the same site (default: its baseline),
 * computed on every read from the two audits' stored findings and check results.
 */
export const getComparison = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({ auditId: Schema.String, against: Schema.optionalKey(Schema.String) }),
    ),
  )
  .handler(({ context, data }) =>
    read(
      Effect.gen(function* () {
        const { organizationId: orgId } = yield* membership(context.session)
        return yield* comparisonOf(orgId, data.auditId, data.against)
      }),
    ),
  )

/**
 * The tags that disappeared, appeared or changed between two audits of a site, on the runs both
 * captured completely. Loaded when the Tags section of the Compare tab opens.
 */
export const getTagDiff = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .validator(
    Schema.toStandardSchemaV1(Schema.Struct({ auditId: Schema.String, against: Schema.String })),
  )
  .handler(({ context, data }) =>
    read(
      Effect.gen(function* () {
        const { organizationId: orgId } = yield* membership(context.session)
        return yield* tagDiffOf(orgId, data.auditId, data.against)
      }),
    ),
  )
