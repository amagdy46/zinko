import { Database } from "@repo/core/Database"
import { orgBranding, organization } from "@repo/db"
import { scrubPersonalData } from "@repo/rules"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { ACCENTS, type AccentId, DEFAULT_ACCENT } from "@/lib/report-accent"

/*
 * Kept out of `branding.ts` (which routes import for its server functions): an exported value in
 * that file would be bundled into the client build with the database code it uses.
 */

/** What an organization without an `org_branding` row gets; the agency name is the organization's. */
export const BRANDING_DEFAULTS = {
  accent: DEFAULT_ACCENT,
  footerText: null,
  showPoweredBy: true,
  logoKey: null,
  logoType: null,
  logoSha256: null,
}

const isAccentId = (value: string): value is AccentId =>
  ACCENTS.some((accent) => accent.id === value)

/** The organization's branding; the defaults when it never saved any. */
export const brandingOf = (orgId: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    const [row] = yield* db
      .select({
        agencyName: orgBranding.agencyName,
        accent: orgBranding.accent,
        footerText: orgBranding.footerText,
        showPoweredBy: orgBranding.showPoweredBy,
        logoKey: orgBranding.logoKey,
        logoType: orgBranding.logoType,
        logoSha256: orgBranding.logoSha256,
      })
      .from(orgBranding)
      .where(eq(orgBranding.orgId, orgId))
      .limit(1)
    if (row !== undefined)
      return { ...row, accent: isAccentId(row.accent) ? row.accent : DEFAULT_ACCENT }
    const [org] = yield* db
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, orgId))
      .limit(1)
    return { ...BRANDING_DEFAULTS, agencyName: org?.name ?? "" }
  })

/** Whether the text holds an email address or phone number, which a report prints as typed. */
export const hasPersonalData = (text: string | null) =>
  text !== null && scrubPersonalData(text) !== text
