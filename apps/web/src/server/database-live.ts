import { DatabaseLayer } from "@repo/db"
import { Layer } from "effect"
import { WorkerEnvLive } from "./cloudflare"

/** `Database` on the Worker's Hyperdrive binding; one instance, shared by `AppLayer` and Better Auth's hooks. */
export const DatabaseLive = DatabaseLayer.pipe(Layer.provide(WorkerEnvLive))
