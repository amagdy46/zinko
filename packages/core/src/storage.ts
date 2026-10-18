import { Context, Data, type Effect, type Option } from "effect"

export class StorageError extends Data.TaggedError("StorageError")<{
  readonly operation: string
  readonly cause: unknown
}> {}

export interface StoredObject {
  readonly key: string
  readonly size: number
  readonly contentType: string | undefined
}

export interface StoredFile extends StoredObject {
  /** Streamed from the bucket, not buffered; it can be read once. */
  readonly body: ReadableStream
}

/** The Storage layer could not be built: a required secret is missing or too weak. */
export class StorageConfigError extends Data.TaggedError("StorageConfigError")<{
  readonly message: string
}> {}

export interface PutOptions {
  readonly contentType?: string
}

export interface SignedUrlOptions {
  /** Defaults to one hour. */
  readonly expiresInSeconds?: number
}

/**
 * Object storage. The Cloudflare layer is backed by R2.
 *
 * R2 bindings can't presign URLs (that needs S3 API credentials), so `signedUrl` returns a path on
 * this Worker (`/files/<key>?expires=..&signature=..`) that serves the object while the HMAC
 * signature is valid. `verify` checks one (constant-time, rejects expired and malformed ones).
 *
 * Keys are opaque: generate them on the server (for example `crypto.randomUUID()`), never from
 * raw user input, because anyone holding a signed URL can read exactly that key. The Worker serves
 * files as attachments with `nosniff`, and inline only for raster images.
 */
export class Storage extends Context.Service<
  Storage,
  {
    readonly put: (
      key: string,
      body: string | Uint8Array,
      options?: PutOptions,
    ) => Effect.Effect<StoredObject, StorageError>
    readonly get: (key: string) => Effect.Effect<Option.Option<StoredFile>, StorageError>
    readonly delete: (key: string) => Effect.Effect<void, StorageError>
    readonly signedUrl: (
      key: string,
      options?: SignedUrlOptions,
    ) => Effect.Effect<string, StorageError>
    readonly verify: (
      key: string,
      expires: string | null,
      signature: string | null,
    ) => Effect.Effect<boolean, StorageError>
  }
>()("@repo/core/Storage") {}
