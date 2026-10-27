import { createServerFn } from "@tanstack/react-start"
import { Effect, Schema } from "effect"
import { MatrixView } from "@/lib/tag-matrix"
import { auditInOrg } from "./audit-data"
import { cellDetailOf, cellsOf, sliceOf, tagsOf } from "./matrix-data"
import { requireSession } from "./require-session"
import { membership, NotFound, read } from "./server-fn"

const MatrixInput = Schema.Struct({ auditId: Schema.String, ...MatrixView.fields })

/**
 * The Tag matrix of one audit, one viewport: columns (scenarios, or pages for one scenario) with
 * exact run counts by coverage, one page of tag rows, and per tag and column the top events or
 * the consent states of the hits, all counted on the server. The runs are reached through the
 * audit, so another organization's audit is a 404.
 */
export const getTagMatrix = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(MatrixInput))
  .handler(({ context, data }) =>
    read(
      Effect.gen(function* () {
        const { organizationId: orgId } = yield* membership(context.session)
        const auditId = yield* auditInOrg(orgId, data.auditId)
        const slice = yield* sliceOf(orgId, auditId, data)
        const tags = yield* tagsOf(orgId, slice, data.tagPage)
        const cells = yield* cellsOf(orgId, slice, tags.rows, data.mode)
        return {
          viewport: slice.viewport,
          viewports: slice.viewports,
          scenarios: slice.scenarios,
          pages: slice.pages,
          journey: slice.journey,
          by: slice.by,
          page: slice.page,
          scenario: slice.scenario,
          columns: slice.columns,
          ...tags,
          cells,
        }
      }),
    ),
  )

const CellInput = Schema.Struct({
  ...MatrixInput.fields,
  column: Schema.String,
  vendor: Schema.String,
  destinationId: Schema.String,
})

/** Every event of one tag in one column and the hits of each of the column's runs. */
export const getMatrixCell = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(CellInput))
  .handler(({ context, data }) =>
    read(
      Effect.gen(function* () {
        const { organizationId: orgId } = yield* membership(context.session)
        const auditId = yield* auditInOrg(orgId, data.auditId)
        const slice = yield* sliceOf(orgId, auditId, data)
        if (!slice.columns.some((c) => c.key === data.column))
          return yield* new NotFound({ message: "Not found" })
        return yield* cellDetailOf(orgId, slice, data.column, data.vendor, data.destinationId)
      }),
    ),
  )
