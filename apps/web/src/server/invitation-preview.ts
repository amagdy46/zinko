import { Database } from "@repo/core/Database"
import { invitation, organization, user } from "@repo/db"
import { createServerFn } from "@tanstack/react-start"
import { and, eq, gt } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { read } from "./server-fn"

/**
 * Who invited a visitor and to what, before they sign in. The invitation id is the only secret
 * needed, so the answer is no more than the organization's name and the inviter's name, and a
 * pending, unexpired invitation is the only one that answers; every other id gets `null`.
 */
export const getInvitationPreview = createServerFn({ method: "GET" })
  .validator(
    Schema.toStandardSchemaV1(Schema.Struct({ id: Schema.String.check(Schema.isMaxLength(64)) })),
  )
  .handler(({ data }) =>
    read(
      Effect.gen(function* () {
        const { db } = yield* Database
        const [found] = yield* db
          .select({ organizationName: organization.name, inviterName: user.name })
          .from(invitation)
          .innerJoin(organization, eq(organization.id, invitation.organizationId))
          .innerJoin(user, eq(user.id, invitation.inviterId))
          .where(
            and(
              eq(invitation.id, data.id),
              eq(invitation.status, "pending"),
              gt(invitation.expiresAt, new Date()),
            ),
          )
        return found ?? null
      }),
    ),
  )
