import type { Session } from "@repo/core/Auth"
import { Database } from "@repo/core/Database"
import { site } from "@repo/db"
import { notFound } from "@tanstack/react-router"
import { and, eq } from "drizzle-orm"
import { Config, Data, Effect, Option, type Layer } from "effect"
import { WorkerConfig } from "effect-cf"
import type { AppLayer } from "./layers"
import { activeMembership } from "./org-access"
import { runtime } from "./runtime"

export class NotFound extends Data.TaggedError("NotFound")<{ readonly message: string }> {}
export class Forbidden extends Data.TaggedError("Forbidden")<{ readonly message: string }> {}
export class Invalid extends Data.TaggedError("Invalid")<{ readonly message: string }> {}

type Env = Layer.Success<typeof AppLayer>

type Expected = NotFound | Forbidden | Invalid

const isExpected = (error: unknown): error is Expected =>
  error instanceof NotFound || error instanceof Forbidden || error instanceof Invalid

/**
 * Runs a server function's Effect. An id from another organization, or none at all, is a 404 for
 * everyone; the other expected failures come back as a message for the form. Any other failure
 * (the database, a binding) is a defect and surfaces as a server error.
 */
export const respond = <A, E, R extends Env>(effect: Effect.Effect<A, E, R>) =>
  runtime
    .runPromise(
      effect.pipe(
        Effect.map((value) => ({ ok: true as const, value })),
        Effect.catch((error: E) =>
          isExpected(error)
            ? Effect.succeed({
                ok: false as const,
                missing: error instanceof NotFound,
                message: error.message,
              })
            : Effect.die(error),
        ),
      ),
    )
    .then((result) => {
      if (result.ok) return { ok: true as const, value: result.value }
      if (result.missing) throw notFound()
      return { ok: false as const, message: result.message }
    })

/** `respond` for reads: any expected failure is a 404. */
export const read = <A, E, R extends Env>(effect: Effect.Effect<A, E, R>) =>
  respond(effect).then((result) => {
    if (!result.ok) throw notFound()
    return result.value
  })

/** The session's organization and role; a user who is not (or no longer) a member gets a 404. */
export const membership = (session: Session) =>
  activeMembership(session).pipe(Effect.mapError(() => new NotFound({ message: "Not found" })))

/** Owners and admins. The role is a comma-separated list, such as `member,admin`. */
export const isManager = (role: string) => {
  const roles = role.split(",")
  return roles.includes("owner") || roles.includes("admin")
}

export const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

/** A site of the organization, archived or not. `lock` takes a row lock; it only holds inside `atomically`. */
export const siteInOrg = (orgId: string, id: string, lock = false) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    if (!isUuid(id)) return yield* new NotFound({ message: "Not found" })
    const query = db
      .select()
      .from(site)
      .where(and(eq(site.id, id), eq(site.orgId, orgId)))
    const [found] = yield* lock ? query.for("update") : query
    if (found === undefined) return yield* new NotFound({ message: "Not found" })
    return found
  })

/** Runs the statements in one database transaction: they all apply or none does. */
export const atomically = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const { db } = yield* Database
    return yield* db.$client.withTransaction(effect)
  })

/** `ALLOW_PRIVATE_SITES` is set by infra/alchemy.run.ts on local dev stages only. */
export const allowPrivateSites = Effect.gen(function* () {
  const provider = yield* WorkerConfig.provider
  const value = yield* Config.option(Config.String("ALLOW_PRIVATE_SITES")).parse(provider)
  return Option.isSome(value) && value.value === "true"
}).pipe(Effect.orDie)
