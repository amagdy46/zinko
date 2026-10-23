import { Schema } from "effect"
import type { CDPSession } from "playwright"

const Paused = Schema.Struct({
  requestId: Schema.String,
  frameId: Schema.String,
  resourceType: Schema.String,
  networkId: Schema.optionalKey(Schema.String),
  redirectedRequestId: Schema.optionalKey(Schema.String),
  request: Schema.Struct({
    url: Schema.String,
    method: Schema.String,
    headers: Schema.Record(Schema.String, Schema.String),
    postData: Schema.optionalKey(Schema.String),
  }),
})
export type PausedRequest = typeof Paused.Type
export type FetchReply = (
  method: "Fetch.continueRequest" | "Fetch.failRequest" | "Fetch.fulfillRequest",
  params: { requestId: string } & Record<string, unknown>,
) => Promise<unknown>

type Send = (method: string, params: Record<string, unknown>) => Promise<unknown>
const Message = Schema.fromJsonString(
  Schema.Struct({
    id: Schema.optionalKey(Schema.Finite),
    method: Schema.optionalKey(Schema.String),
    params: Schema.optionalKey(Schema.Unknown),
    error: Schema.optionalKey(Schema.Unknown),
  }),
)
const Attached = Schema.Struct({ sessionId: Schema.String })
const Received = Schema.Struct({ sessionId: Schema.String, message: Schema.String })
const autoAttach = {
  autoAttach: true,
  waitForDebuggerOnStart: true,
  flatten: false,
  filter: [{ type: "iframe", exclude: false }, { exclude: true }],
}

/** OOPIFs have their own Fetch domain. Pause each before its scripts run, including nested frames. */
export const guardFrameTargets = async (
  cdp: CDPSession,
  patterns: readonly Record<string, string>[],
  onPaused: (event: PausedRequest, reply: FetchReply) => void,
  onError: (cause: unknown) => void,
) => {
  const listen = (sendMessage: (sessionId: string, message: string) => Promise<unknown>) => {
    const children = new Map<string, (raw: string) => void>()
    return (method: string, params: unknown) => {
      if (method === "Target.receivedMessageFromTarget") {
        const event = Schema.decodeUnknownSync(Received)(params)
        children.get(event.sessionId)?.(event.message)
      } else if (method === "Target.attachedToTarget") {
        const { sessionId } = Schema.decodeUnknownSync(Attached)(params)
        let nextId = 0
        const pending = new Map<number, { resolve: () => void; reject: (cause: unknown) => void }>()
        const childSend: Send = (command, args) =>
          new Promise<void>((resolve, reject) => {
            const id = ++nextId
            pending.set(id, { resolve, reject })
            sendMessage(sessionId, JSON.stringify({ id, method: command, params: args })).catch(
              (cause: unknown) => {
                pending.delete(id)
                reject(cause)
              },
            )
          })
        const childEvent = listen((nestedSessionId, message) =>
          childSend("Target.sendMessageToTarget", { sessionId: nestedSessionId, message }),
        )
        children.set(sessionId, (raw) => {
          const message = Schema.decodeSync(Message)(raw)
          if (message.id !== undefined) {
            const waiting = pending.get(message.id)
            pending.delete(message.id)
            if (message.error === undefined) waiting?.resolve()
            else waiting?.reject(message.error)
          } else if (message.method === "Fetch.requestPaused") {
            onPaused(Schema.decodeUnknownSync(Paused)(message.params), childSend)
          } else if (message.method !== undefined) {
            childEvent(message.method, message.params)
          }
        })
        const enable = async () => {
          await childSend("Fetch.enable", { patterns })
          await childSend("Target.setAutoAttach", autoAttach)
          await childSend("Runtime.runIfWaitingForDebugger", {})
        }
        enable().catch(onError)
      } else if (method === "Target.detachedFromTarget") {
        children.delete(Schema.decodeUnknownSync(Attached)(params).sessionId)
      }
    }
  }
  const event = listen((sessionId, message) =>
    cdp.send("Target.sendMessageToTarget", { sessionId, message }),
  )
  cdp.on("Target.attachedToTarget", (params) => event("Target.attachedToTarget", params))
  cdp.on("Target.receivedMessageFromTarget", (params) =>
    event("Target.receivedMessageFromTarget", params),
  )
  cdp.on("Target.detachedFromTarget", (params) => event("Target.detachedFromTarget", params))
  await cdp.send("Target.setAutoAttach", autoAttach)
}
