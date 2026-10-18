import { isMessageTooLarge, MAX_ROOM_CONNECTIONS } from "@repo/core/realtime-limits"
import { Effect, Layer, Schema } from "effect"
import { DurableObject, DurableObjectState, DurableObjectWebSocket, Worker } from "effect-cf"

export class RoomNamespace extends DurableObject.Tag<RoomNamespace>()("Room", {
  broadcast: DurableObject.method({ args: [Schema.String], success: Schema.Void }),
  connections: DurableObject.method({ success: Schema.Finite }),
}) {}

const sockets = Effect.flatMap(DurableObjectState.DurableObjectState, (state) =>
  state.getWebSockets(),
)

const broadcast = (message: string) =>
  Effect.gen(function* () {
    for (const socket of yield* sockets) yield* Effect.ignore(socket.send(message))
  })

/**
 * One chat room. Sockets are hibernating: Cloudflare keeps them open while the object is evicted
 * from memory and wakes it only when a client sends a message, so idle rooms cost nothing.
 * Bound as ROOM in wrangler.jsonc and exported from `src/server.ts`.
 */
export class Room extends RoomNamespace.make(Layer.empty, {
  // ping/pong keepalives are answered by Cloudflare without waking the object
  initialize: DurableObjectWebSocket.installKeepalive(),
  rpc: {
    broadcast,
    connections: () => Effect.map(sockets, (all) => all.length),
  },
  fetch: Effect.gen(function* () {
    const request = yield* Worker.NativeRequest
    if (request.headers.get("Upgrade") !== "websocket")
      return new Response("Expected a WebSocket upgrade", { status: 426 })
    if ((yield* sockets).length >= MAX_ROOM_CONNECTIONS)
      return new Response("Room is full", { status: 503 })
    return (yield* DurableObjectWebSocket.acceptUpgrade()).response
  }),
  // binary frames are ignored; oversized text closes the sender (1009 = message too big)
  webSocketMessage: (socket, message) => {
    if (typeof message !== "string") return Effect.void
    if (isMessageTooLarge(message)) return Effect.ignore(socket.close(1009, "Message too big"))
    return broadcast(message)
  },
  webSocketClose: (socket, code, reason) => Effect.ignore(socket.close(code, reason)),
}) {}
