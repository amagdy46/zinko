import { MAX_ROOM_CONNECTIONS } from "@repo/core/realtime-limits"
import { Effect, Layer, Schema } from "effect"
import { DurableObject, DurableObjectState, DurableObjectWebSocket, Worker } from "effect-cf"

export class AuditRoomNamespace extends DurableObject.Tag<AuditRoomNamespace>()("AuditRoom", {
  publish: DurableObject.method({ args: [Schema.String], success: Schema.Void }),
}) {}

const sockets = Effect.flatMap(DurableObjectState.DurableObjectState, (state) =>
  state.getWebSockets(),
)

/**
 * The live progress of one audit, named by audit id. Browsers only listen: the Worker route
 * authorizes the upgrade before it reaches here, and `publish` is the only way a message enters.
 * Sockets hibernate, so an idle room costs nothing. Bound as AUDIT_ROOM, exported from `src/server.ts`.
 */
export class AuditRoom extends AuditRoomNamespace.make(Layer.empty, {
  // ping/pong keepalives are answered by Cloudflare without waking the object
  initialize: DurableObjectWebSocket.installKeepalive(),
  rpc: {
    publish: (message) =>
      Effect.gen(function* () {
        for (const socket of yield* sockets) yield* Effect.ignore(socket.send(message))
      }),
  },
  fetch: Effect.gen(function* () {
    const request = yield* Worker.NativeRequest
    if (request.headers.get("Upgrade") !== "websocket")
      return new Response("Expected a WebSocket upgrade", { status: 426 })
    if ((yield* sockets).length >= MAX_ROOM_CONNECTIONS)
      return new Response("Room is full", { status: 503 })
    return (yield* DurableObjectWebSocket.acceptUpgrade()).response
  }),
  // clients only listen; whatever they send is dropped
  webSocketMessage: () => Effect.void,
  webSocketClose: (socket, code, reason) => Effect.ignore(socket.close(code, reason)),
}) {}
