import { Storage } from "@repo/core"
import { downloadHeaders, parseSignedParams } from "@repo/core/storage-security"
import { Effect, Option } from "effect"
import type { WorkerRoute } from "./routes"
import { runtime } from "./runtime"

const prefix = "/files/"

const decodeKey = (encoded: string) => {
  try {
    return decodeURIComponent(encoded)
  } catch {
    return undefined
  }
}

/**
 * Serves `/files/<key>?expires=..&signature=..` (see `Storage.signedUrl`) straight from the bucket.
 * Keys are opaque: whoever holds a signed URL can read that key, so never build keys from user input.
 * Malformed URLs get 400, bad or expired signatures 403, a missing signing secret 500.
 */
export const storageRoute: WorkerRoute = async (request) => {
  const url = new URL(request.url)
  if (request.method !== "GET" || !url.pathname.startsWith(prefix)) return undefined
  const key = decodeKey(url.pathname.slice(prefix.length))
  const params = parseSignedParams(
    url.searchParams.get("expires"),
    url.searchParams.get("signature"),
  )
  if (key === undefined || key === "" || params === undefined)
    return new Response("Bad request", { status: 400 })
  return runtime
    .runPromise(
      Effect.gen(function* () {
        const storage = yield* Storage
        const valid = yield* storage.verify(key, params.expires, params.signature)
        if (!valid) return new Response("Forbidden", { status: 403 })
        const file = yield* storage.get(key)
        if (Option.isNone(file)) return new Response("Not found", { status: 404 })
        return new Response(file.value.body, {
          headers: downloadHeaders(key, file.value.contentType),
        })
      }).pipe(Effect.orElseSucceed(() => new Response("Storage error", { status: 502 }))),
    )
    .catch((error: unknown) => {
      // the runtime failed to build, e.g. STORAGE_SIGNING_SECRET is missing or too short
      console.error("Storage unavailable:", error)
      return new Response("Storage is not configured", { status: 500 })
    })
}
