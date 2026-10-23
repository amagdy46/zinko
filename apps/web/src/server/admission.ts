import { AdmissionError, Browser, CaptureAdmission, ENGINE_FREE_EVENT, Jobs } from "@repo/core"
import { Effect, Layer } from "effect"
import { AdmissionGateNamespace } from "../browser/AdmissionGate"
import { BrowserLive } from "./browser"
import { WorkerEnvLive } from "./cloudflare"
import { JobsLive } from "./jobs"

const fail = (operation: string) => (cause: unknown) => new AdmissionError({ operation, cause })

const make = Effect.gen(function* () {
  const gate = (yield* AdmissionGateNamespace).byName("engines")
  const { engines } = yield* Browser
  const jobs = yield* Jobs
  // a woken audit asks at once; one that misses the event asks again within a minute anyway
  const wake = (promoted: ReadonlyArray<string>) =>
    Effect.forEach(
      promoted,
      (auditId) =>
        jobs
          .sendEvent("audit", auditId, ENGINE_FREE_EVENT)
          .pipe(Effect.ignoreCause({ log: "Warn", message: "Waiting audit not woken" })),
      { discard: true },
    )
  return CaptureAdmission.of({
    admit: (auditId, turn) =>
      gate.admit(auditId, turn, engines).pipe(
        Effect.mapError(fail("admit")),
        Effect.tap(({ promoted }) => wake(promoted)),
        Effect.map(({ admission }) => admission),
      ),
    confirm: (auditId, { token }) =>
      gate.confirm(auditId, token, engines).pipe(
        Effect.mapError(fail("confirm")),
        Effect.tap(({ promoted }) => wake(promoted)),
        Effect.map(({ held }) => held),
      ),
    release: (auditId, { token }) =>
      gate
        .release(auditId, token, engines)
        .pipe(Effect.mapError(fail("release")), Effect.flatMap(wake)),
  })
})

/** `CaptureAdmission` on the ADMISSION_GATE Durable Object, for the engines `Browser` has. */
export const CaptureAdmissionLive = Layer.effect(CaptureAdmission, make).pipe(
  Layer.provide(AdmissionGateNamespace.layer({ binding: "ADMISSION_GATE" })),
  Layer.provide(Layer.mergeAll(BrowserLive, JobsLive)),
  Layer.provide(WorkerEnvLive),
)
