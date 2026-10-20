import { AuditProgress, AuditProgressError } from "@repo/core"
import { isAuditId } from "@repo/core/realtime-limits"
import { Effect, Layer } from "effect"
import { AuditRoomNamespace } from "../realtime/AuditRoom"
import { WorkerEnvLive } from "./cloudflare"

const make = Effect.gen(function* () {
  const namespace = yield* AuditRoomNamespace
  return AuditProgress.of({
    publish: (auditId, event) =>
      isAuditId(auditId)
        ? namespace
            .byName(auditId.toLowerCase())
            .publish(JSON.stringify(event))
            .pipe(
              Effect.mapError((cause) => new AuditProgressError({ operation: "publish", cause })),
            )
        : Effect.fail(
            new AuditProgressError({ operation: "publish", cause: `invalid audit id: ${auditId}` }),
          ),
  })
})

/** `AuditProgress` on the AUDIT_ROOM Durable Object namespace; the namespace is provided too, for the room route. */
export const AuditProgressLive = Layer.effect(AuditProgress, make).pipe(
  Layer.provideMerge(AuditRoomNamespace.layer({ binding: "AUDIT_ROOM" })),
  Layer.provide(WorkerEnvLive),
)
