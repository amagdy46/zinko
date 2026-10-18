import { Realtime } from "@repo/core"
import { isValidRoomId } from "@repo/core/realtime-limits"
import { Effect } from "effect"
import type { WorkerRoute } from "./routes"
import { runtime } from "./runtime"

const pattern = /^\/ws\/rooms\/([^/]+)$/

const decodeRoomId = (encoded: string) => {
  try {
    return decodeURIComponent(encoded)
  } catch {
    return undefined
  }
}

/**
 * WebSocket upgrades on `/ws/rooms/<roomId>` go to that room's Durable Object. Room ids are 1-64
 * word characters or dashes (400 otherwise); the room caps connections and message size.
 */
export const realtimeRoute: WorkerRoute = async (request) => {
  const match = pattern.exec(new URL(request.url).pathname)
  if (match?.[1] === undefined) return undefined
  const roomId = decodeRoomId(match[1])
  if (roomId === undefined || !isValidRoomId(roomId))
    return new Response("Invalid room id", { status: 400 })
  return runtime
    .runPromise(
      Effect.gen(function* () {
        const realtime = yield* Realtime
        return yield* realtime.connect(roomId, request)
      }).pipe(Effect.orElseSucceed(() => new Response("Realtime error", { status: 502 }))),
    )
    .catch((error: unknown) => {
      // the runtime failed to build (a layer is misconfigured)
      console.error("Realtime unavailable:", error)
      return new Response("Server is not configured", { status: 500 })
    })
}
