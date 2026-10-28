import { gcdFinalState } from "@ovriq/zinko-decoders"
import type { ConsentState } from "@ovriq/zinko-decoders"
import { isGoogle } from "./consent-state.js"
import { hitRef, isGtagCommand, pushesByDocument, pushRef } from "./documents.js"
import type { DecodedHit, EvidenceRef, RunInput } from "./types.js"

/** The four Google Consent Mode signals, in the order a message names them. */
export const SIGNALS = [
  "ad_storage",
  "analytics_storage",
  "ad_user_data",
  "ad_personalization",
] as const
export type Signal = (typeof SIGNALS)[number]

/**
 * What a signal was said to be at one moment: a consent command or a Google request. A request
 * whose own `gcs` and `gcd` disagree is an explicit `unknown`, which replaces whatever was settled
 * before it; a request with nothing to say about the signal is no event at all.
 */
export interface SignalEvent {
  at: number
  state: "granted" | "denied" | "unknown"
  /** Set for a `default` or `update` command; absent for a request. */
  command?: "default" | "update"
  ref: EvidenceRef
}

function definite(state: ConsentState | "unset"): "granted" | "denied" | undefined {
  return state === "granted" || state === "denied" ? state : undefined
}

/**
 * The state one request carries for one signal. `gcs` names ad and analytics storage, `gcd` all
 * four; when both say something and disagree, the request is an explicit `unknown`.
 */
export function hitState(
  hit: DecodedHit,
  signal: Signal,
): "granted" | "denied" | "unknown" | undefined {
  const gcs: Partial<Record<Signal, ConsentState>> = {
    ad_storage: hit.consent.adStorage,
    analytics_storage: hit.consent.analyticsStorage,
  }
  const fromGcs = definite(gcs[signal] ?? "unknown")
  const gcd = hit.gcd
  const gcdSignal =
    gcd === undefined
      ? undefined
      : {
          ad_storage: gcd.adStorage,
          analytics_storage: gcd.analyticsStorage,
          ad_user_data: gcd.adUserData,
          ad_personalization: gcd.adPersonalization,
        }[signal]
  const fromGcd = gcdSignal === undefined ? undefined : definite(gcdFinalState(gcdSignal))
  if (fromGcs !== undefined && fromGcd !== undefined && fromGcs !== fromGcd) return "unknown"
  return fromGcs ?? fromGcd
}

/**
 * Every statement about `signal` made in one document, in time order. An `update` changes only
 * the signals it names; a signal with no statement has no event (it is unknown, never denied).
 * Ties order a command before a request.
 */
export function signalEvents(
  input: RunInput,
  documentId: string,
  signal: Signal,
): readonly SignalEvent[] {
  const commands = (pushesByDocument(input).get(documentId) ?? []).flatMap(
    (push): SignalEvent[] => {
      if (!isGtagCommand(push, "consent") || !Array.isArray(push.value)) return []
      const [, kind, params] = push.value
      if (
        (kind !== "default" && kind !== "update") ||
        typeof params !== "object" ||
        params === null
      )
        return []
      const state: unknown = Reflect.get(params, signal)
      return state === "granted" || state === "denied"
        ? [{ at: push.at, state, command: kind, ref: pushRef(push) }]
        : []
    },
  )
  const requests = input.hits.flatMap((hit): SignalEvent[] => {
    const state =
      hit.documentId === documentId && isGoogle(hit.vendor) ? hitState(hit, signal) : undefined
    return state === undefined ? [] : [{ at: hit.startedAt, state, ref: hitRef(hit) }]
  })
  return [...commands, ...requests].toSorted(
    (a, b) => a.at - b.at || Number(a.command === undefined) - Number(b.command === undefined),
  )
}

/** The state at the end of the document: the latest statement, or `unknown` when there is none. */
export function settledState(events: readonly SignalEvent[]): ConsentState {
  return events.at(-1)?.state ?? "unknown"
}

/**
 * A signal reverted in a document only when its final command there is `denied` (or it has none)
 * and a request carrying `denied` was sent at or after that command, with no `granted` request
 * after it. A denying request before the final command, or followed by a granting command, never
 * counts. Returns the evidence of the revert, or `undefined`.
 */
export function revert(events: readonly SignalEvent[]): readonly EvidenceRef[] | undefined {
  const final = events.findLast((event) => event.command !== undefined)
  if (final !== undefined && final.state !== "denied") return undefined
  const after = events.filter(
    (event) => event.command === undefined && event.at >= (final?.at ?? Number.NEGATIVE_INFINITY),
  )
  const denying = after.find((event) => event.state === "denied")
  if (denying === undefined || after.some((event) => event.state === "granted")) return undefined
  return final === undefined ? [denying.ref] : [final.ref, denying.ref]
}
