import { Storage, StorageConfigError, StorageError } from "@repo/core"
import { MIN_SECRET_LENGTH, signPayload, verifyPayload } from "@repo/core/storage-security"
import { Config, ConfigProvider, Effect, Layer, Option, Redacted } from "effect"
import { R2, WorkerConfig } from "effect-cf"
import { WorkerEnvLive } from "./cloudflare"

class StorageBucket extends R2.Tag<StorageBucket>()("StorageBucket") {}

/** The signing secret, read once when the layer is built. Fails with a clear message if unusable. */
const loadSecret = (provider: ConfigProvider.ConfigProvider) =>
  Config.Redacted("STORAGE_SIGNING_SECRET").pipe(
    Effect.provideService(ConfigProvider.ConfigProvider, provider),
    Effect.mapError(
      () =>
        new StorageConfigError({
          message:
            "STORAGE_SIGNING_SECRET is not set. Set it to a random string of at least 32 characters (wrangler secret put STORAGE_SIGNING_SECRET, or .dev.vars locally).",
        }),
    ),
    Effect.map(Redacted.value),
    Effect.filterOrFail(
      (secret) => secret.length >= MIN_SECRET_LENGTH,
      () =>
        new StorageConfigError({
          message: `STORAGE_SIGNING_SECRET is too short: use at least ${MIN_SECRET_LENGTH} characters.`,
        }),
    ),
  )

const fail = (operation: string) => (cause: unknown) => new StorageError({ operation, cause })

const make = Effect.gen(function* () {
  const bucket = yield* StorageBucket
  const secret = yield* loadSecret(yield* WorkerConfig.provider)
  return Storage.of({
    put: (key, body, options) =>
      bucket
        .put(
          key,
          body,
          options?.contentType === undefined
            ? {}
            : { httpMetadata: { contentType: options.contentType } },
        )
        .pipe(
          Effect.map((o) => ({
            key: o.key,
            size: o.size,
            contentType: o.httpMetadata?.contentType,
          })),
          Effect.mapError(fail("put")),
        ),
    get: (key) =>
      Effect.gen(function* () {
        const found = yield* bucket.get(key)
        if (Option.isNone(found)) return Option.none()
        const object = found.value
        return Option.some({
          key,
          size: object.size,
          contentType: object.httpMetadata?.contentType,
          body: object.body,
        })
      }).pipe(Effect.mapError(fail("get"))),
    delete: (key) => bucket.delete(key).pipe(Effect.mapError(fail("delete"))),
    signedUrl: (key, options) =>
      Effect.gen(function* () {
        const expires = String(Math.floor(Date.now() / 1000) + (options?.expiresInSeconds ?? 3600))
        const signature = yield* Effect.promise(() => signPayload(secret, key, expires))
        return `/files/${encodeURIComponent(key)}?expires=${expires}&signature=${signature}`
      }).pipe(Effect.mapError(fail("signedUrl"))),
    verify: (key, expires, signature) =>
      Effect.gen(function* () {
        if (expires === null || signature === null) return false
        return yield* Effect.promise(() => verifyPayload(secret, key, expires, signature))
      }).pipe(Effect.mapError(fail("verify"))),
  })
})

/** `Storage` on the `STORAGE` R2 bucket binding. */
export const StorageLive = Layer.effect(Storage, make).pipe(
  Layer.provide(StorageBucket.layer({ binding: "STORAGE" })),
  Layer.provide(WorkerEnvLive),
)
