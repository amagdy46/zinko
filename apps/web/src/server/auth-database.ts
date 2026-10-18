import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { drizzle } from "drizzle-orm/node-postgres"
import { Context, Effect, Layer } from "effect"
import { Hyperdrive } from "effect-cf"
import { Pool } from "pg"
import * as schema from "@repo/db"
import type { AuthSettings } from "./auth"

/** The `HYPERDRIVE` binding, read for Better Auth's own connection. */
class AuthHyperdrive extends Hyperdrive.Tag<AuthHyperdrive>()("AuthHyperdrive") {}

/**
 * Better Auth's database. It is promise-based, so it gets plain `drizzle-orm/node-postgres` over a
 * `pg` pool on the Hyperdrive connection string rather than the Effect-flavoured `Database` client.
 * The pool lives as long as the layer, which on Postgres is one request.
 */
export class AuthDatabase extends Context.Service<
  AuthDatabase,
  { readonly database: AuthSettings["database"] }
>()("AuthDatabase") {}

export const AuthDatabaseLayer = Layer.effect(
  AuthDatabase,
  Effect.gen(function* () {
    const { connectionString } = yield* AuthHyperdrive
    const pool = yield* Effect.acquireRelease(
      Effect.sync(() => new Pool({ connectionString, max: 1 })),
      (opened) => Effect.promise(() => opened.end()),
    )
    return { database: drizzleAdapter(drizzle({ client: pool }), { provider: "pg", schema }) }
  }),
).pipe(Layer.provide(AuthHyperdrive.layer({ binding: "HYPERDRIVE" })))
