/**
 * Tracks every process an engine starts so all of them can be killed. Killing the engine's
 * process group is not enough: Playwright and patchright start Chromium in a session of its own,
 * and once the engine dies its descendants are re-parented and can no longer be found from it.
 * So the tree is sampled from /proc while the engine runs, and every process group seen is killed.
 */
import { readdirSync, readFileSync } from "node:fs"

type Entry = { readonly ppid: number; readonly pgid: number }

const readTable = (): Map<number, Entry> => {
  const table = new Map<number, Entry>()
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue
    let stat: string
    try {
      stat = readFileSync(`/proc/${name}/stat`, "latin1")
    } catch {
      continue
    }
    // pid (comm) state ppid pgrp ...; comm may contain spaces and parentheses
    const [, ppid = "0", pgid = "0"] = stat.slice(stat.lastIndexOf(")") + 2).split(" ")
    table.set(Number(name), { ppid: Number(ppid), pgid: Number(pgid) })
  }
  return table
}

const signal = (target: number) => {
  try {
    process.kill(target, "SIGKILL")
  } catch {
    // already gone
  }
}

export type ProcessTree = {
  /** Records the root's current descendants and their process groups. */
  readonly sample: () => void
  /** SIGKILLs the root and every process group seen, except this server's own group. */
  readonly kill: () => void
}

export const watchProcessTree = (root: number): ProcessTree => {
  const ownGroup = readTable().get(process.pid)?.pgid
  const groups = new Set<number>([root])

  const sample = () => {
    const table = readTable()
    const children = new Map<number, number[]>()
    for (const [pid, entry] of table)
      children.set(entry.ppid, [...(children.get(entry.ppid) ?? []), pid])
    const stack = [root]
    while (stack.length > 0) {
      const pid = stack.pop() ?? root
      const entry = table.get(pid)
      if (entry === undefined) continue
      groups.add(entry.pgid)
      stack.push(...(children.get(pid) ?? []))
    }
  }

  return {
    sample,
    kill: () => {
      sample()
      signal(root)
      for (const group of groups) if (group > 1 && group !== ownGroup) signal(-group)
    },
  }
}
