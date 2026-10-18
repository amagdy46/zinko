import { Realtime, RealtimeError } from "@repo/core"
import { isValidRoomId } from "@repo/core/realtime-limits"
import { Effect, Layer } from "effect"
import { RoomNamespace } from "../realtime/Room"
import { WorkerEnvLive } from "./cloudflare"

const fail = (operation: string) => (cause: unknown) => new RealtimeError({ operation, cause })

const make = Effect.gen(function* () {
  const namespace = yield* RoomNamespace
  // room ids reach here from URLs and server functions: only accept the documented shape
  const room = (
    operation: string,
    roomId: string,
  ): Effect.Effect<ReturnType<typeof namespace.byName>, RealtimeError> =>
    isValidRoomId(roomId)
      ? Effect.succeed(namespace.byName(roomId))
      : Effect.fail(new RealtimeError({ operation, cause: `invalid room id: ${roomId}` }))
  return Realtime.of({
    connect: (roomId, request) =>
      room("connect", roomId).pipe(
        Effect.flatMap((stub) => stub.fetch(request).pipe(Effect.mapError(fail("connect")))),
      ),
    broadcast: (roomId, message) =>
      room("broadcast", roomId).pipe(
        Effect.flatMap((stub) => stub.broadcast(message).pipe(Effect.mapError(fail("broadcast")))),
      ),
    connections: (roomId) =>
      room("connections", roomId).pipe(
        Effect.flatMap((stub) => stub.connections().pipe(Effect.mapError(fail("connections")))),
      ),
  })
})

/** `Realtime` on the ROOM Durable Object namespace. */
export const RealtimeLive = Layer.effect(Realtime, make).pipe(
  Layer.provide(RoomNamespace.layer({ binding: "ROOM" })),
  Layer.provide(WorkerEnvLive),
)
