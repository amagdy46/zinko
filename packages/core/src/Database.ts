import type { makeWithDefaults } from "drizzle-orm/effect-postgres"
import { Context, type Effect } from "effect"

/**
 * The app's database, as a Drizzle client whose queries are Effects. `$client` is the underlying
 * SQL client, for `$client.withTransaction(effect)`: Drizzle's own `transaction` infers an
 * `any` error type.
 */
export class Database extends Context.Service<
  Database,
  { readonly db: Effect.Success<ReturnType<typeof makeWithDefaults>> }
>()("@repo/core/Database") {}
