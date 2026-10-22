import { Admission } from "@repo/core"
import { Clock, Effect, Layer, Schema } from "effect"
import { DurableObject, DurableObjectState } from "effect-cf"

const Engines = Schema.Array(Schema.String)
const Promoted = Schema.Array(Schema.String)

export class AdmissionGateNamespace extends DurableObject.Tag<AdmissionGateNamespace>()(
  "AdmissionGate",
  {
    admit: DurableObject.method({
      args: [Schema.String, Engines],
      success: Schema.Struct({ admission: Admission, promoted: Promoted }),
    }),
    release: DurableObject.method({ args: [Schema.String, Engines], success: Promoted }),
  },
) {}

const State = Schema.Struct({
  holders: Schema.Array(
    Schema.Struct({ holder: Schema.String, engine: Schema.String, until: Schema.Number }),
  ),
  waiting: Schema.Array(Schema.Struct({ holder: Schema.String, seen: Schema.Number })),
})
type State = typeof State.Type

// A holder asks again before each capture, and a capture step gives up an attempt after 4
// minutes; a holder that stops asking for longer has crashed or is stuck retrying, and loses its
// engine.
const LEASE_MS = 5 * 60_000
// A waiter handed an engine is woken by an event and re-asks within a minute even without it.
const CLAIM_MS = 90_000
// Waiters re-ask every minute; one that stopped (a deleted workflow) leaves the line.
const WAITER_MS = 3 * 60_000

const KEY = "state"
const decodeState = Schema.decodeUnknownEffect(State)

const load = Effect.gen(function* () {
  const { storage } = yield* DurableObjectState.DurableObjectState
  const stored = yield* storage.get(KEY)
  return stored === undefined ? { holders: [], waiting: [] } : yield* decodeState(stored)
})

const save = (state: State) =>
  Effect.flatMap(DurableObjectState.DurableObjectState, ({ storage }) => storage.put(KEY, state))

const holds = (h: State["holders"][number], engines: ReadonlyArray<string>, now: number) =>
  h.until > now && engines.includes(h.engine)

/**
 * Drops lapsed holders and silent waiters, then hands every free engine to the head of the line.
 * Returns the new state and who was handed an engine.
 */
const settle = (state: State, engines: ReadonlyArray<string>, now: number) => {
  const holders = state.holders.filter((h) => holds(h, engines, now))
  const waiting = state.waiting.filter(
    (w) => w.seen > now - WAITER_MS && !holders.some((h) => h.holder === w.holder),
  )
  const free = engines.filter((engine) => !holders.some((h) => h.engine === engine))
  const handed = free.flatMap((engine, i) => {
    const next = waiting[i]
    return next === undefined ? [] : [{ holder: next.holder, engine, until: now + CLAIM_MS }]
  })
  return {
    state: { holders: [...holders, ...handed], waiting: waiting.slice(handed.length) },
    promoted: handed.map((h) => h.holder),
  }
}

/**
 * The line for the capture engines, one per deployment (named `engines`). Each audit holds one
 * engine from its first capture to its last, and audits get engines in the order they first
 * asked. State is kept in storage, so it survives eviction; every change happens between one read
 * and one write with no other I/O, so concurrent calls cannot interleave. Bound as ADMISSION_GATE,
 * exported from `src/server.ts`.
 */
export class AdmissionGate extends AdmissionGateNamespace.make(Layer.empty, {
  rpc: {
    admit: (holder, engines) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const current = yield* load
        const holding = current.holders.some((h) => h.holder === holder && holds(h, engines, now))
        const asked: State = holding
          ? current
          : {
              holders: current.holders,
              waiting: current.waiting.some((w) => w.holder === holder)
                ? current.waiting.map((w) => (w.holder === holder ? { holder, seen: now } : w))
                : [...current.waiting, { holder, seen: now }],
            }
        const settled = settle(asked, engines, now)
        const held = settled.state.holders.find((h) => h.holder === holder)
        const state: State = {
          holders: settled.state.holders.map((h) =>
            h.holder === holder ? { ...h, until: now + LEASE_MS } : h,
          ),
          waiting: settled.state.waiting,
        }
        yield* save(state)
        return {
          admission:
            held === undefined
              ? {
                  position: state.waiting.findIndex((w) => w.holder === holder) + 1,
                }
              : { engine: held.engine },
          promoted: settled.promoted.filter((h) => h !== holder),
        }
      }),
    release: (holder, engines) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const current = yield* load
        const settled = settle(
          {
            holders: current.holders.filter((h) => h.holder !== holder),
            waiting: current.waiting.filter((w) => w.holder !== holder),
          },
          engines,
          now,
        )
        yield* save(settled.state)
        return settled.promoted
      }),
  },
}) {}
