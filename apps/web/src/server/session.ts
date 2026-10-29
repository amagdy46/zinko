import { Auth } from "@repo/core/Auth"
import { createServerFn } from "@tanstack/react-start"
import { getRequestHeaders } from "@tanstack/react-start/server"
import { Effect } from "effect"
import { BetterAuth } from "./auth-live"
import { groupByClientOf } from "./org-setting-data"
import { runtime } from "./runtime"

/** The signed-in user, or null. Route guards call this. */
export const getSession = createServerFn({ method: "GET" }).handler(() =>
  runtime.runPromise(
    Effect.gen(function* () {
      const auth = yield* Auth
      return yield* auth.currentSession
    }).pipe(Effect.catchTag("Unauthorized", () => Effect.succeed(null))),
  ),
)

/**
 * What the app shell needs: the session and the organizations the user belongs to. A user who
 * belongs to organizations but has none active (for example after signing in again), or whose active
 * one they were removed from, gets the first one. A user with none is sent to onboarding.
 */
export const getAppState = createServerFn({ method: "GET" }).handler(() =>
  runtime.runPromise(
    Effect.gen(function* () {
      const { currentSession } = yield* Auth
      const session = yield* currentSession
      const auth = yield* BetterAuth
      const headers = getRequestHeaders()
      const organizations = yield* Effect.promise(() => auth.api.listOrganizations({ headers }))
      const first = organizations[0]
      let activeOrganizationId = session.activeOrganizationId
      const stale = !organizations.some(({ id }) => id === activeOrganizationId)
      if (stale && first !== undefined) {
        activeOrganizationId = first.id
        yield* Effect.promise(() =>
          auth.api.setActiveOrganization({ headers, body: { organizationId: first.id } }),
        )
      }
      const groupByClient =
        activeOrganizationId !== null && organizations.some(({ id }) => id === activeOrganizationId)
          ? yield* groupByClientOf(activeOrganizationId)
          : false
      return {
        session: { ...session, activeOrganizationId },
        organizations: organizations.map(({ id, name, slug }) => ({ id, name, slug })),
        groupByClient,
      }
    }).pipe(Effect.catchTag("Unauthorized", () => Effect.succeed(null))),
  ),
)
