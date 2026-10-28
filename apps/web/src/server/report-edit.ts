import { Database } from "@repo/core/Database"
import { finding, reportEdit, reportFindingEdit } from "@repo/db"
import { createServerFn } from "@tanstack/react-start"
import { and, eq } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { hasPersonalData } from "./branding-data"
import { auditInOrg } from "./audit-data"
import { requireSession } from "./require-session"
import { Invalid, membership, NotFound, mutation } from "./server-fn"

const SUMMARY_MAX = 2000
const NOTE_MAX = 1000

const OwnerId = Schema.Literals(["consent-platform", "tag-manager", "developer"])

const SaveReportInput = Schema.Struct({
  auditId: Schema.String,
  summary: Schema.optional(Schema.String),
  detail: Schema.optional(Schema.Literals(["standard", "detailed"])),
})

const SaveFindingInput = Schema.Struct({
  auditId: Schema.String,
  ruleId: Schema.String,
  note: Schema.optional(Schema.String),
  hidden: Schema.optional(Schema.Boolean),
  owner: Schema.optional(Schema.NullOr(OwnerId)),
})

/**
 * The consultant's summary and disclosure level for an audit. Only the fields sent change; an
 * empty summary goes back to the generated one. Any member may edit; another organization's audit
 * is a 404 before anything is written. `personalData` says the summary holds something that looks
 * like an email or a phone number: it is saved as typed and the form warns.
 */
export const saveReportEdit = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(SaveReportInput))
  .handler(({ context, data }) =>
    mutation(
      Effect.gen(function* () {
        const { organizationId: orgId, userId } = yield* membership(context.session)
        const auditId = yield* auditInOrg(orgId, data.auditId)
        const summary = data.summary?.trim()
        if (summary !== undefined && summary.length > SUMMARY_MAX)
          return yield* new Invalid({
            message: `The summary can be at most ${SUMMARY_MAX} characters.`,
          })
        const { db } = yield* Database
        // Only what the caller sent is updated, so two saves of different fields cannot undo each other.
        const sent = {
          ...(summary === undefined ? {} : { summary: summary || null }),
          ...(data.detail === undefined ? {} : { detail: data.detail }),
        }
        const stamp = { updatedBy: userId, updatedAt: new Date() }
        yield* db
          .insert(reportEdit)
          .values({ auditId, orgId, ...sent, ...stamp })
          .onConflictDoUpdate({ target: reportEdit.auditId, set: { ...sent, ...stamp } })
        return { personalData: hasPersonalData(sent.summary ?? null) }
      }),
    ),
  )

/**
 * The consultant's note, "leave out of the detail" flag and owner override for one finding of an
 * audit. Only the fields sent change; an empty note clears it and `owner: null` goes back to the
 * rule's own hint. A rule that is not a finding of this audit is a 404.
 */
export const saveFindingEdit = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(SaveFindingInput))
  .handler(({ context, data }) =>
    mutation(
      Effect.gen(function* () {
        const { organizationId: orgId, userId } = yield* membership(context.session)
        const auditId = yield* auditInOrg(orgId, data.auditId)
        const note = data.note?.trim()
        if (note !== undefined && note.length > NOTE_MAX)
          return yield* new Invalid({ message: `A note can be at most ${NOTE_MAX} characters.` })
        const { db } = yield* Database
        const [found] = yield* db
          .select({ ruleId: finding.ruleId })
          .from(finding)
          .where(
            and(
              eq(finding.auditId, auditId),
              eq(finding.orgId, orgId),
              eq(finding.ruleId, data.ruleId),
            ),
          )
          .limit(1)
        if (found === undefined) return yield* new NotFound({ message: "Not found" })
        const sent = {
          ...(note === undefined ? {} : { note: note || null }),
          ...(data.hidden === undefined ? {} : { hidden: data.hidden }),
          ...(data.owner === undefined ? {} : { owner: data.owner }),
        }
        const stamp = { updatedBy: userId, updatedAt: new Date() }
        yield* db
          .insert(reportFindingEdit)
          .values({ auditId, orgId, ruleId: found.ruleId, ...sent, ...stamp })
          .onConflictDoUpdate({
            target: [reportFindingEdit.auditId, reportFindingEdit.ruleId],
            set: { ...sent, ...stamp },
          })
        return { personalData: hasPersonalData(sent.note ?? null) }
      }),
    ),
  )
