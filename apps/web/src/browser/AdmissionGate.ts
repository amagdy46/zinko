import { Admission } from "@repo/core"
import { Clock, Effect, Layer, Schema } from "effect"
import { DurableObject, DurableObjectState } from "effect-cf"

const Engines = Schema.Array(Schema.String)
const Promoted = Schema.Array(Schema.String)

export class AdmissionGateNamespace extends DurableObject.Tag<AdmissionGateNamespace>()(
  "AdmissionGate",
  {
    admit: DurableObject.method({
      args: [Schema.String, Schema.String, Engines],
      success: Schema.Struct({ admission: Admission, promoted: Promoted }),
    }),
    confirm: DurableObject.method({
      args: [Schema.String, Schema.String, Engines],
      success: Schema.Struct({ held: Schema.Boolean, promoted: Promoted }),
    }),
    release: DurableObject.method({
      args: [Schema.String, Schema.String, Engines],
      success: Promoted,
    }),
  },
) {}

const Holder = Schema.Struct({
  holder: Schema.String,
  turn: Schema.String,
  token: Schema.String,
  engine: Schema.String,
  until: Schema.Finite,
})
type Holder = typeof Holder.Type

const State = Schema.Struct({
  holders: Schema.Array(Holder),
  waiting: Schema.Array(
    Schema.Struct({ holder: Schema.String, turn: Schema.String, seen: Schema.Finite }),
  ),
})
type State = typeof State.Type

// A grant must be confirmed by its capture step within this long; a workflow that dies between
// `admit-<n>` and `capture-<n>` gives its engine back quickly.
const CLAIM_MS = 90_000
// A confirmed grant lasts one capture attempt: the step gives up an attempt after 4 minutes and
// releases the engine when it ends, so the lease only matters when the attempt crashed.
const LEASE_MS = 5 * 60_000
// Waiters re-ask every minute; one that stopped (a deleted workflow) leaves the line.
const WAITER_MS = 3 * 60_000

const KEY = "state"
// Keep holders stored before tokens and turns existed until their lease ends; an upgrade must not
// free a running engine.
const decodeState = Schema.decodeUnknownEffect(
  Schema.Struct({
    holders: Schema.Array(
      Schema.Struct({
        ...Holder.fields,
        token: Schema.optionalKey(Schema.String),
        turn: Schema.optionalKey(Schema.String),
      }),
    ),
    waiting: Schema.Array(
      Schema.Struct({
        holder: Schema.String,
        seen: Schema.Finite,
        turn: Schema.optionalKey(Schema.String),
      }),
    ),
  }),
)

const load = Effect.gen(function* () {
  const { storage } = yield* DurableObjectState.DurableObjectState
  const stored = yield* storage.get(KEY)
  if (stored === undefined) return { holders: [], waiting: [] }
  const state = yield* decodeState(stored)
  return {
    ...state,
    holders: state.holders.map((h) => ({
      holder: h.holder,
      engine: h.engine,
      until: h.until,
      token: h.token ?? crypto.randomUUID(),
      turn: h.turn ?? "",
    })),
    waiting: state.waiting.map((w) => ({ holder: w.holder, seen: w.seen, turn: w.turn ?? "" })),
  }
})

const save = (state: State) =>
  Effect.flatMap(DurableObjectState.DurableObjectState, ({ storage }) => storage.put(KEY, state))

const live = (h: Holder, engines: ReadonlyArray<string>, now: number) =>
  h.until > now && engines.includes(h.engine)

/**
 * Drops lapsed grants and silent waiters, then hands every free engine to the head of the line.
 * Returns the new state and who was handed an engine.
 */
const settle = (state: State, engines: ReadonlyArray<string>, now: number) => {
  const holders = state.holders.filter((h) => live(h, engines, now))
  const waiting = state.waiting.filter(
    (w) => w.seen > now - WAITER_MS && !holders.some((h) => h.holder === w.holder),
  )
  const free = engines.filter((engine) => !holders.some((h) => h.engine === engine))
  const handed = free.flatMap((engine, i) => {
    const next = waiting[i]
    return next === undefined
      ? []
      : [
          {
            holder: next.holder,
            turn: next.turn,
            token: crypto.randomUUID(),
            engine,
            until: now + CLAIM_MS,
          },
        ]
  })
  return {
    state: { holders: [...holders, ...handed], waiting: waiting.slice(handed.length) },
    promoted: handed.map((h) => h.holder),
  }
}

/** Runs `change` on the stored state at `now` and writes the result back. */
const update = <A>(change: (state: State, now: number) => { state: State; result: A }) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    const { state, result } = change(yield* load, now)
    yield* save(state)
    return result
  })

/**
 * The line for the capture engines, one per deployment (named `engines`). Every capture asks
 * for an engine and gives it back when it ends, so audits take turns capture by capture, in the
 * order they asked. A grant carries a token, and a capture runs only after `confirm` finds its
 * token still holding the engine. State is kept in storage, so it survives eviction; every change
 * happens between one read and one write with no other I/O, so concurrent calls cannot interleave.
 * Bound as ADMISSION_GATE, exported from `src/server.ts`.
 */
export class AdmissionGate extends AdmissionGateNamespace.make(Layer.empty, {
  rpc: {
    // An audit asks for one capture turn at a time. Asking again for the same turn (a retried
    // step) returns the same grant or place. Asking for another turn means the audit is done with
    // its earlier one, so a grant it failed to release is dropped and the new turn joins the tail
    // behind the waiters.
    admit: (holder, turn, engines) =>
      update((current, now) => {
        const holding = current.holders.some(
          (h) => h.holder === holder && h.turn === turn && live(h, engines, now),
        )
        const waiting = current.waiting.some((w) => w.holder === holder && w.turn === turn)
          ? current.waiting.map((w) =>
              w.holder === holder && w.turn === turn ? { ...w, seen: now } : w,
            )
          : [...current.waiting.filter((w) => w.holder !== holder), { holder, turn, seen: now }]
        const settled = settle(
          holding
            ? current
            : {
                holders: current.holders.filter((h) => h.holder !== holder),
                waiting,
              },
          engines,
          now,
        )
        const held = settled.state.holders.find((h) => h.holder === holder && h.turn === turn)
        return {
          state: settled.state,
          result: {
            admission:
              held === undefined
                ? { position: settled.state.waiting.findIndex((w) => w.holder === holder) + 1 }
                : { engine: held.engine, token: held.token },
            promoted: settled.promoted.filter((h) => h !== holder),
          },
        }
      }),
    confirm: (holder, token, engines) =>
      update((current, now) => {
        const settled = settle(current, engines, now)
        const held = settled.state.holders.some((h) => h.holder === holder && h.token === token)
        return {
          state: {
            holders: settled.state.holders.map((h) =>
              h.holder === holder && h.token === token ? { ...h, until: now + LEASE_MS } : h,
            ),
            waiting: settled.state.waiting,
          },
          result: { held, promoted: settled.promoted },
        }
      }),
    release: (holder, token, engines) =>
      update((current, now) => {
        const settled = settle(
          {
            holders: current.holders.filter((h) => !(h.holder === holder && h.token === token)),
            waiting: current.waiting,
          },
          engines,
          now,
        )
        return { state: settled.state, result: settled.promoted }
      }),
  },
}) {}
