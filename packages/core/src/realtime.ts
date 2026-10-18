import { Context, Data, type Effect } from "effect"

export class RealtimeError extends Data.TaggedError("RealtimeError")<{
  readonly operation: string
  readonly cause: unknown
}> {}

/** Rooms of WebSocket clients. The Cloudflare layer keeps each room in a Durable Object. */
export class Realtime extends Context.Service<
  Realtime,
  {
    /** Forwards a WebSocket upgrade request to the room; the response completes the handshake. */
    readonly connect: (roomId: string, request: Request) => Effect.Effect<Response, RealtimeError>
    /** Sends `message` to every client connected to the room. */
    readonly broadcast: (roomId: string, message: string) => Effect.Effect<void, RealtimeError>
    /** Number of clients currently connected to the room. */
    readonly connections: (roomId: string) => Effect.Effect<number, RealtimeError>
  }
>()("@repo/core/Realtime") {}
