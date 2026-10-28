import type { CellKey } from "./compare"

/*
 * Which tags (vendor, destination, event) a page sent in one audit and not the other. Only cells
 * both audits ran and captured completely are compared: a run that did not finish may be missing a
 * tag, which is "could not tell", never "disappeared".
 */

export type TagChangeKind = "disappeared" | "new" | "destination_changed" | "events_changed"

export interface TagChange {
  change: TagChangeKind
  vendor: string
  destinationId: string
  /** For `destination_changed`, and for the `events_changed` of a destination that changed. */
  previousDestinationId: string | null
  eventsAdded: string[]
  eventsRemoved: string[]
  cellsAffected: number
  /** Compared cells where the vendor sent a tag in either audit. */
  cellsCompared: number
  /** At most 10, indexes into `TagDiff.cells`. */
  cells: number[]
}

export interface TagDiff {
  cells: CellKey[]
  changes: TagChange[]
  /** Changes beyond the 40 listed. */
  omitted: number
  compared: number
  /** Cells in both audits where either run did not finish: not compared. */
  unfinished: number
}

export interface TagRun {
  id: string
  cell: CellKey
  cellId: string
  /** Whether the run captured completely. */
  complete: boolean
}

export interface TagTriple {
  runId: string
  vendor: string
  destinationId: string
  event: string
}

const MAX_CHANGES = 40
const MAX_CELLS = 10
const KIND_ORDER: TagChangeKind[] = ["disappeared", "destination_changed", "events_changed", "new"]
const order = (a: string, b: string) => {
  if (a < b) return -1
  return a > b ? 1 : 0
}

type Seen = Map<string, Map<string, Set<string>>>

/** vendor -> destination -> events, for one run. */
const seenOf = (triples: ReadonlyArray<TagTriple>): Seen => {
  const seen: Seen = new Map()
  for (const t of triples) {
    const destinations = seen.get(t.vendor) ?? new Map<string, Set<string>>()
    const events = destinations.get(t.destinationId) ?? new Set<string>()
    events.add(t.event)
    destinations.set(t.destinationId, events)
    seen.set(t.vendor, destinations)
  }
  return seen
}

const without = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  [...a].filter((x) => !b.has(x)).toSorted(order)

interface CellChange {
  change: TagChangeKind
  vendor: string
  destinationId: string
  previousDestinationId: string | null
  eventsAdded: string[]
  eventsRemoved: string[]
}

/** The changes of one vendor on one cell. A removed and an added destination pair up as a change of destination. */
const vendorChanges = (
  vendor: string,
  before: Map<string, Set<string>>,
  now: Map<string, Set<string>>,
): CellChange[] => {
  const removed = [...before.keys()].filter((d) => !now.has(d)).toSorted(order)
  const added = [...now.keys()].filter((d) => !before.has(d)).toSorted(order)
  const found: CellChange[] = []
  const base = { vendor, previousDestinationId: null, eventsAdded: [], eventsRemoved: [] }
  const paired = Math.min(removed.length, added.length)
  for (let i = 0; i < paired; i++) {
    const from = removed[i] ?? ""
    const to = added[i] ?? ""
    found.push({
      ...base,
      change: "destination_changed",
      destinationId: to,
      previousDestinationId: from,
    })
    const was = before.get(from) ?? new Set<string>()
    const is = now.get(to) ?? new Set<string>()
    if (without(was, is).length > 0 || without(is, was).length > 0)
      found.push({
        ...base,
        change: "events_changed",
        destinationId: to,
        previousDestinationId: from,
        eventsAdded: without(is, was),
        eventsRemoved: without(was, is),
      })
  }
  for (const destinationId of removed.slice(paired))
    found.push({ ...base, change: "disappeared", destinationId })
  for (const destinationId of added.slice(paired))
    found.push({ ...base, change: "new", destinationId })
  for (const [destinationId, events] of before) {
    const is = now.get(destinationId)
    if (is === undefined) continue
    if (without(events, is).length > 0 || without(is, events).length > 0)
      found.push({
        ...base,
        change: "events_changed",
        destinationId,
        eventsAdded: without(is, events),
        eventsRemoved: without(events, is),
      })
  }
  return found
}

export const diffTags = (input: {
  before: { runs: ReadonlyArray<TagRun>; tags: ReadonlyArray<TagTriple> }
  now: { runs: ReadonlyArray<TagRun>; tags: ReadonlyArray<TagTriple> }
}): TagDiff => {
  const { before, now } = input
  const nowByCell = new Map(now.runs.map((r) => [r.cellId, r]))
  const group = (side: typeof before) => {
    const byRun = new Map<string, TagTriple[]>()
    for (const t of side.tags) byRun.set(t.runId, [...(byRun.get(t.runId) ?? []), t])
    return byRun
  }
  const tagsBefore = group(before)
  const tagsNow = group(now)

  const cells: CellKey[] = []
  const aggregated = new Map<string, TagChange>()
  const comparedByVendor = new Map<string, number>()
  const affectedCells = new Map<string, number[]>()
  let compared = 0
  let unfinished = 0
  for (const runBefore of before.runs) {
    const runNow = nowByCell.get(runBefore.cellId)
    if (runNow === undefined) continue
    if (!runBefore.complete || !runNow.complete) {
      unfinished += 1
      continue
    }
    compared += 1
    const seenBefore = seenOf(tagsBefore.get(runBefore.id) ?? [])
    const seenNow = seenOf(tagsNow.get(runNow.id) ?? [])
    let at: number | undefined
    for (const vendor of new Set([...seenBefore.keys(), ...seenNow.keys()])) {
      comparedByVendor.set(vendor, (comparedByVendor.get(vendor) ?? 0) + 1)
      for (const c of vendorChanges(
        vendor,
        seenBefore.get(vendor) ?? new Map(),
        seenNow.get(vendor) ?? new Map(),
      )) {
        if (at === undefined) {
          at = cells.length
          cells.push(runBefore.cell)
        }
        const key = JSON.stringify([
          c.change,
          c.vendor,
          c.destinationId,
          c.previousDestinationId,
          c.eventsAdded,
          c.eventsRemoved,
        ])
        const held = aggregated.get(key)
        if (held === undefined)
          aggregated.set(key, { ...c, cellsAffected: 1, cellsCompared: 0, cells: [] })
        else held.cellsAffected += 1
        affectedCells.set(key, [...(affectedCells.get(key) ?? []), at])
      }
    }
  }
  for (const [key, change] of aggregated) {
    change.cellsCompared = comparedByVendor.get(change.vendor) ?? 0
    change.cells = (affectedCells.get(key) ?? []).slice(0, MAX_CELLS)
  }
  const all = [...aggregated.values()].toSorted(
    (a, b) =>
      KIND_ORDER.indexOf(a.change) - KIND_ORDER.indexOf(b.change) ||
      order(a.vendor, b.vendor) ||
      order(a.destinationId, b.destinationId),
  )
  const listed = all.slice(0, MAX_CHANGES)
  const used = [...new Set(listed.flatMap((c) => c.cells))].toSorted((a, b) => a - b)
  const remap = new Map(used.map((old, index) => [old, index]))
  for (const change of listed) change.cells = change.cells.flatMap((old) => remap.get(old) ?? [])
  return {
    cells: used.flatMap((old) => {
      const cell = cells[old]
      return cell === undefined ? [] : [cell]
    }),
    changes: listed,
    omitted: all.length - listed.length,
    compared,
    unfinished,
  }
}
