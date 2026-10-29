import { PgClient } from "@effect/sql-pg"
import * as PgDrizzle from "drizzle-orm/effect-postgres"
import { migrate } from "drizzle-orm/effect-postgres/migrator"
import { Config, Effect, Redacted } from "effect"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { backfillDefaultClients } from "./backfill-default-clients.ts"

// `pnpm db:migrate`: applies packages/db/drizzle/* to DATABASE_URL (default: the docker-compose database).
// Reads the repository's `.env` like the app does; a variable already in the process environment wins.
const envFile = join(import.meta.dirname, "../../../.env")
if (existsSync(envFile)) process.loadEnvFile(envFile)

const url = Config.Redacted("DATABASE_URL").pipe(
  Config.withDefault(Redacted.make("postgres://postgres:postgres@localhost:5432/app")),
)

const program = Effect.gen(function* () {
  const db = yield* PgDrizzle.makeWithDefaults()
  // drizzle types the migrator's error as `unknown`; any failure here should abort the script
  // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context
  yield* migrate(db, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname }).pipe(
    Effect.orDie,
  )
  yield* backfillDefaultClients(db).pipe(Effect.orDie)
  yield* Effect.log("migrations applied")
}).pipe(Effect.provide(PgClient.layerConfig({ url })))

Effect.runPromise(program).catch((error) => {
  console.error(error)
  process.exit(1)
})
