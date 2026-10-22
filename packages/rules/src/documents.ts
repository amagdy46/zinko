import type { CaptureResult } from "@repo/capture-contract"
import type { DecodedHit, EvidenceRef, RunInput } from "./types.js"

export type Push = CaptureResult["dataLayer"][number] & {
  /** Position in the capture's `dataLayer`, the push's key in storage. */
  seq: number
}

/** The run's `dataLayer` pushes per document id, in push order. */
export function pushesByDocument(input: RunInput): ReadonlyMap<string, readonly Push[]> {
  const byDocument = new Map<string, Push[]>()
  input.capture.dataLayer.forEach((push, seq) => {
    const list = byDocument.get(push.documentId) ?? []
    list.push({ ...push, seq })
    byDocument.set(push.documentId, list)
  })
  return byDocument
}

/** A gtag command push whose array starts with `path`: `"consent", "default"`, or `"config"`. */
export function isGtagCommand(push: Push, ...path: readonly string[]): boolean {
  const { value } = push
  return Array.isArray(value) && path.every((part, index) => value[index] === part)
}

export function hitRef(hit: DecodedHit): EvidenceRef {
  return { kind: "hit", requestId: hit.requestId, batchIndex: hit.batchIndex }
}

export function requestRef(requestId: string): EvidenceRef {
  return { kind: "request", requestId }
}

export function pushRef(push: Push): EvidenceRef {
  return { kind: "push", seq: push.seq }
}

export function documentRef(documentId: string): EvidenceRef {
  return { kind: "document", documentId }
}

/** `3 hits`, `1 hit`. */
export function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`
}

/** Names in first-seen order, without repeats. */
export function distinct(values: Iterable<string>): string[] {
  return [...new Set(values)]
}

/** Items grouped by key, groups and their items in first-seen order. */
export function groupBy<T>(items: Iterable<T>, key: (item: T) => string): Map<string, [T, ...T[]]> {
  const groups = new Map<string, [T, ...T[]]>()
  for (const item of items) {
    const k = key(item)
    const group = groups.get(k)
    if (group === undefined) groups.set(k, [item])
    else group.push(item)
  }
  return groups
}

const VENDOR_NAMES: Record<DecodedHit["vendor"], string> = {
  ga4: "GA4",
  "google-ads": "Google Ads",
  meta: "Meta",
  tiktok: "TikTok",
}

export function vendorName(vendor: DecodedHit["vendor"]): string {
  return VENDOR_NAMES[vendor]
}
