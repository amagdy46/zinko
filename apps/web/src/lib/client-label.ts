const suffix = (id: string, length: number) => id.replace(/-/g, "").slice(-length)

const nameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLocaleLowerCase()

/**
 * What tells clients with the same name apart: the name of their first site, else the end of their
 * id, and both when two of them would still read the same. Clients with a name of their own get
 * nothing.
 */
export function distinguishers(
  clients: ReadonlyArray<{ id: string; name: string; firstSite: string | null }>,
): Map<string, string> {
  const groups = new Map<string, Array<{ id: string; firstSite: string | null }>>()
  for (const c of clients) groups.set(nameKey(c.name), [...(groups.get(nameKey(c.name)) ?? []), c])
  const labels = new Map<string, string>()
  for (const group of groups.values()) {
    if (group.length < 2) continue
    // The id suffix grows until every label in the group differs; the whole id always does.
    for (const length of [4, 8, 12, 32]) {
      const plain = group.map((c) => c.firstSite ?? `#${suffix(c.id, length)}`)
      const candidate =
        new Set(plain).size === group.length
          ? plain
          : group.map((c) =>
              c.firstSite === null
                ? `#${suffix(c.id, length)}`
                : `${c.firstSite} · #${suffix(c.id, length)}`,
            )
      if (new Set(candidate).size < group.length && length < 32) continue
      for (const [i, c] of group.entries()) labels.set(c.id, candidate[i] ?? c.id)
      break
    }
  }
  return labels
}
