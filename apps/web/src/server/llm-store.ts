import { Database } from "@repo/core/Database"
import { LlmError } from "@repo/core/llm"
import { LlmCredentialStore } from "@repo/core/llm-store"
import { llmCredential } from "@repo/db"
import { eq } from "drizzle-orm"
import { Effect, Layer, Option } from "effect"

const fail = (operation: string) => (cause: unknown) => new LlmError({ operation, cause })

/** `LlmCredentialStore` over the `llm_credential` table, through the Database service. */
export const LlmCredentialStoreLive = Layer.effect(
  LlmCredentialStore,
  Effect.gen(function* () {
    const { db } = yield* Database
    return LlmCredentialStore.of({
      find: (orgId) =>
        db
          .select()
          .from(llmCredential)
          .where(eq(llmCredential.orgId, orgId))
          .limit(1)
          .pipe(
            Effect.map((rows) => Option.fromNullishOr(rows[0])),
            Effect.mapError(fail("find credential")),
          ),
      upsert: (row) =>
        db
          .insert(llmCredential)
          .values(row)
          .onConflictDoUpdate({
            target: llmCredential.orgId,
            set: {
              provider: row.provider,
              model: row.model,
              encryptedKey: row.encryptedKey,
              baseUrl: row.baseUrl,
              updatedAt: new Date(),
            },
          })
          .pipe(Effect.asVoid, Effect.mapError(fail("save credential"))),
      remove: (orgId) =>
        db
          .delete(llmCredential)
          .where(eq(llmCredential.orgId, orgId))
          .pipe(Effect.asVoid, Effect.mapError(fail("clear credential"))),
    })
  }),
)
