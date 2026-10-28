import { Database } from "@repo/core/Database"
import { orgBranding } from "@repo/db"
import { createServerFn } from "@tanstack/react-start"
import { Effect, Schema } from "effect"
import { ACCENTS } from "@/lib/report-accent"
import { brandingOf, hasPersonalData } from "./branding-data"
import { requireSession } from "./require-session"
import { Forbidden, Invalid, isManager, membership, read, respond } from "./server-fn"

const NAME_MAX = 80
const FOOTER_MAX = 300

const SaveInput = Schema.Struct({
  agencyName: Schema.String,
  accent: Schema.Literals(ACCENTS.map((accent) => accent.id)),
  footerText: Schema.String,
  showPoweredBy: Schema.Boolean,
})

const view = (branding: Effect.Success<ReturnType<typeof brandingOf>>, canManage: boolean) => ({
  branding: {
    agencyName: branding.agencyName,
    accent: branding.accent,
    footerText: branding.footerText,
    showPoweredBy: branding.showPoweredBy,
    hasLogo: branding.logoKey !== null,
  },
  canManage,
  personalData: hasPersonalData(branding.agencyName) || hasPersonalData(branding.footerText),
})

/** The organization's branding and whether the caller may change it. Any member may read it. */
export const getBranding = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .handler(({ context }) =>
    read(
      Effect.gen(function* () {
        const { organizationId, role } = yield* membership(context.session)
        return view(yield* brandingOf(organizationId), isManager(role))
      }),
    ),
  )

export const saveBranding = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(SaveInput))
  .handler(({ context, data }) =>
    respond(
      Effect.gen(function* () {
        const { organizationId, role, userId } = yield* membership(context.session)
        if (!isManager(role))
          return yield* new Forbidden({
            message: "Only organization owners and admins can change the branding.",
          })
        const agencyName = data.agencyName.trim()
        if (agencyName.length < 1 || agencyName.length > NAME_MAX)
          return yield* new Invalid({
            message: `The agency name must be 1 to ${NAME_MAX} characters.`,
          })
        const footerText = data.footerText.trim()
        if (footerText.length > FOOTER_MAX)
          return yield* new Invalid({
            message: `The footer must be at most ${FOOTER_MAX} characters.`,
          })
        const { db } = yield* Database
        const values = {
          agencyName,
          accent: data.accent,
          footerText: footerText === "" ? null : footerText,
          showPoweredBy: data.showPoweredBy,
          updatedBy: userId,
          updatedAt: new Date(),
        }
        yield* db
          .insert(orgBranding)
          .values({ orgId: organizationId, ...values })
          .onConflictDoUpdate({ target: orgBranding.orgId, set: values })
        return view(yield* brandingOf(organizationId), true)
      }),
    ),
  )
