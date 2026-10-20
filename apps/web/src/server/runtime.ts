import { Effect, type Layer } from "effect"
import { AppLayer } from "./layers"

type AppServices = Layer.Success<typeof AppLayer>

/**
 * Server functions run their Effects through here. Workers must not reuse I/O (such as a
 * Postgres socket) across requests, so unlike a `ManagedRuntime` this builds `AppLayer` for each
 * call and closes it afterwards; Hyperdrive pools the connections behind it.
 */
export const runtime = {
  runPromise: <A, E>(effect: Effect.Effect<A, E, AppServices>): Promise<A> =>
    Effect.runPromise(Effect.provide(effect, AppLayer)),
  /**
   * For Workflow steps, which are entry points too: each attempt builds `AppLayer` and closes it
   * when it ends, because a workflow can sleep between steps and resume in another invocation.
   */
  provide: <A, E>(effect: Effect.Effect<A, E, AppServices>) => Effect.provide(effect, AppLayer),
}
