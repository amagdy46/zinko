import { Storage } from "@repo/core"
import { createServerFn } from "@tanstack/react-start"
import { Effect, Schema } from "effect"
import { brandingOf } from "./branding-data"
import { buildReport } from "./report-data"
import { requireSession } from "./require-session"
import { isManager, membership, read } from "./server-fn"

/** Long enough to read the draft; the page asks again when it reloads. */
const LOGO_URL_SECONDS = 5 * 60

/**
 * The report as it would be shared now: the public model and the consultant-only side payload, or
 * why there is none yet. Any member of the audit's organization may read it.
 */
export const getReportDraft = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ auditId: Schema.String })))
  .handler(({ context, data }) =>
    read(
      Effect.gen(function* () {
        const { organizationId, role } = yield* membership(context.session)
        const built = yield* buildReport(organizationId, data.auditId)
        if (!built.available) return { available: false as const, reason: built.reason }
        const branding = yield* brandingOf(organizationId)
        const storage = yield* Storage
        const logoUrl =
          branding.logoKey === null
            ? null
            : yield* storage
                .signedUrl(branding.logoKey, { expiresInSeconds: LOGO_URL_SECONDS })
                .pipe(Effect.orDie)
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
