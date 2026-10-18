import { env } from "cloudflare:workers"
import { Layer } from "effect"
import { WorkerEnvironment } from "effect-cf"

/**
 * The Worker's `env` as effect-cf's `WorkerEnvironment`. This is the only place `env` is read;
 * everything else gets bindings through effect-cf layers (Hyperdrive, D1, KV, R2, ...) that
 * need `WorkerEnvironment`.
 */
export const WorkerEnvLive = Layer.succeed(WorkerEnvironment, env)
