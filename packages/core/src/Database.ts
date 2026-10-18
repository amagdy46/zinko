import type { EffectPgDatabase } from "drizzle-orm/effect-postgres"
import { Context } from "effect"

/** The app's database, as a Drizzle client whose queries are Effects. */
export class Database extends Context.Service<Database, { readonly db: EffectPgDatabase }>()(
  "@repo/core/Database",
) {}
