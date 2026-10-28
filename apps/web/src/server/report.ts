import { Storage } from "@repo/core"
import { createServerFn } from "@tanstack/react-start"
import { Effect, Option, Schema } from "effect"
import { buildReport } from "./report-data"
import { requireSession } from "./require-session"
import { isManager, membership, read } from "./server-fn"

/** Long enough to read the draft; the page asks again when it reloads. */
const LOGO_URL_SECONDS = 5 * 60

/**
 * The report as it would be shared now: the public model and the consultant-only side payload, or
 * why there is none yet. Any member of the audit's organization may read it. The preview logo is
 * the one the build read (its digest is in the model); if that object is already gone because the
 * logo was replaced meanwhile, the report is built once more.
 */
export const getReportDraft = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ auditId: Schema.String })))
  .handler(({ context, data }) =>
    read(
      Effect.gen(function* () {
        const { organizationId, role } = yield* membership(context.session)
        const storage = yield* Storage
        const attempt = Effect.gen(function* () {
          const built = yield* buildReport(organizationId, data.auditId)
          if (!built.available || built.logo === null)
            return { built, logoUrl: null, current: true }
          const there = yield* storage.head(built.logo.key).pipe(Effect.orDie)
          if (Option.isNone(there)) return { built, logoUrl: null, current: false }
          const logoUrl = yield* storage
            .signedUrl(built.logo.key, { expiresInSeconds: LOGO_URL_SECONDS })
            .pipe(Effect.orDie)
          return { built, logoUrl, current: true }
        })
        const first = yield* attempt
        const { built, logoUrl } = first.current ? first : yield* attempt
        if (!built.available) return { available: false as const, reason: built.reason }
        return {
          available: true as const,
          model: built.model,
          consultant: built.consultant,
          logoUrl,
          canManageBranding: isManager(role),
        }
      }),
    ),
  )
