import { Context, type Effect, type Option } from "effect"
import type { LlmError } from "./llm"

/** One organization's model settings; the key is encrypted (see `llm-crypto.ts`). */
export interface LlmCredentialRow {
  readonly orgId: string
  readonly provider: string
  readonly model: string
  readonly encryptedKey: string
  readonly baseUrl: string | null
}

/** Storage for the `llm_credential` table, one row per organization. */
export class LlmCredentialStore extends Context.Service<
  LlmCredentialStore,
  {
    readonly find: (orgId: string) => Effect.Effect<Option.Option<LlmCredentialRow>, LlmError>
    readonly upsert: (row: LlmCredentialRow) => Effect.Effect<void, LlmError>
    readonly remove: (orgId: string) => Effect.Effect<void, LlmError>
  }
>()("@repo/core/LlmCredentialStore") {}
