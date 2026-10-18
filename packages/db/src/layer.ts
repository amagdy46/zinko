import { Database } from "@repo/core/Database"
import * as PgDrizzle from "drizzle-orm/effect-postgres"
import { Effect, Layer } from "effect"
import { Hyperdrive } from "effect-cf"
import { layer as hyperdrivePg } from "effect-cf/hyperdrive-pg"

/** The `HYPERDRIVE` binding from wrangler.jsonc; its connection string feeds the pg client. */
class AppHyperdrive extends Hyperdrive.Tag<AppHyperdrive>()("AppHyperdrive") {}

const PgLive = hyperdrivePg(AppHyperdrive, { binding: "HYPERDRIVE" })

/** Provides `Database`. Needs effect-cf's `WorkerEnvironment` (see apps/web/src/server/cloudflare.ts). */
export const DatabaseLayer = Layer.effect(
  Database,
  Effect.map(PgDrizzle.makeWithDefaults(), (db) => ({ db })),
).pipe(Layer.provide(PgLive))
