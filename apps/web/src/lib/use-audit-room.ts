import { AuditEvent } from "@repo/core/audit"
import { reconnectDelay } from "@repo/core/realtime-limits"
import { Option, Schema } from "effect"
import { useEffect, useRef, useState } from "react"

/**
 * What `useAuditRoom` hands the page. Every signal means "refetch the audit": `refresh` fires when
 * the socket opens (events missed while it was down cost nothing) and every 4 minutes while open
 * (screenshot URLs expire after 5); `run` and `audit` events fire as progress is published.
 */
export type AuditRoomSignal = AuditEvent | { readonly type: "refresh" }

const decodeEvent = Schema.decodeUnknownOption(Schema.fromJsonString(AuditEvent))

const REFRESH_MS = 4 * 60_000

// answered by Cloudflare without waking the room (see `installKeepalive` in realtime/AuditRoom.ts)
const PING = "effect-cf:ping"
const PONG = "effect-cf:pong"
const PING_MS = 30_000

/** Listens to an audit's progress. Reconnects with exponential backoff and jitter (up to 30 s). */
export function useAuditRoom(auditId: string, onEvent: (signal: AuditRoomSignal) => void) {
  const [connected, setConnected] = useState(false)
  const handler = useRef(onEvent)
  useEffect(() => {
    handler.current = onEvent
  })

  useEffect(() => {
    let closed = false
    let attempt = 0
    let retry: ReturnType<typeof setTimeout> | undefined
    let ping: ReturnType<typeof setInterval> | undefined
    let refresh: ReturnType<typeof setInterval> | undefined
    let ws: WebSocket | undefined

    const connect = () => {
      const scheme = location.protocol === "https:" ? "wss" : "ws"
      ws = new WebSocket(`${scheme}://${location.host}/ws/audits/${encodeURIComponent(auditId)}`)
      const socket = ws
      socket.addEventListener("open", () => {
        setConnected(true)
        attempt = 0
        handler.current({ type: "refresh" })
        ping = setInterval(() => socket.send(PING), PING_MS)
        refresh = setInterval(() => handler.current({ type: "refresh" }), REFRESH_MS)
      })
      socket.addEventListener("message", ({ data }: MessageEvent) => {
        if (typeof data !== "string" || data === PONG) return
        const event = decodeEvent(data)
        if (Option.isSome(event)) handler.current(event.value)
      })
      socket.addEventListener("close", () => {
        clearInterval(ping)
        clearInterval(refresh)
        setConnected(false)
        if (!closed) retry = setTimeout(connect, reconnectDelay(attempt++))
      })
    }
    connect()

    return () => {
      closed = true
      clearTimeout(retry)
      clearInterval(ping)
      clearInterval(refresh)
      ws?.close()
    }
  }, [auditId])

  return { connected }
}
