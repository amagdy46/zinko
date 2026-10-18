import { Context, Data, type Effect } from "effect"

/** The current request has no signed-in user. */
export class Unauthorized extends Data.TaggedError("Unauthorized")<{
  readonly message: string
}> {}

export interface Session {
  readonly userId: string
  readonly email: string
  readonly name: string
  /** The organization the user is working in, or null before they belong to one. */
  readonly activeOrganizationId: string | null
}

/** Who is making the current request. Implemented by Better Auth in apps/web/src/server/auth-live.ts. */
export class Auth extends Context.Service<
  Auth,
  { readonly currentSession: Effect.Effect<Session, Unauthorized> }
>()("@repo/core/Auth") {}
