import type { checkResult, finding } from "@repo/db"

export type StoredCheck = Pick<
  typeof checkResult.$inferSelect,
  | "runId"
  | "orgId"
  | "ruleId"
  | "rulesVersion"
  | "status"
  | "area"
  | "severity"
  | "title"
  | "checkTitle"
  | "owner"
  | "why"
  | "fix"
>

const byVersion = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true })

/**
 * One finding per rule that failed on at least one run (`fail`), or failed on none and was
 * inconclusive on at least one (`inconclusive`). `checks` are in run order, so `run_ids` are too.
 * The text comes from the stored check results, not from `@repo/rules`, so a rule renamed or
 * removed since `persist` still has its finding; when runs were judged by different rules
 * versions, the newest version's text wins.
 */
export const findingsFrom = (auditId: string, checks: ReadonlyArray<StoredCheck>) => {
  const byRule = new Map<string, StoredCheck[]>()
  for (const check of checks) {
    const group = byRule.get(check.ruleId) ?? []
    group.push(check)
    byRule.set(check.ruleId, group)
  }
  const findings: Array<typeof finding.$inferSelect> = []
  for (const [ruleId, group] of byRule) {
    const flagged = group.filter((c) => c.status === "fail" || c.status === "inconclusive")
    if (flagged.length === 0) continue
    const versions = [...new Set(group.map((c) => c.rulesVersion))].toSorted(byVersion)
    const newest = versions.at(-1)
    const inNewest = group.filter((c) => c.rulesVersion === newest)
    const text = inNewest[0]
    if (text === undefined) continue
    // The owner comes from the newest version's rows only: an older version's never fills a null.
    const owner = inNewest.find((c) => c.owner !== null)?.owner ?? null
    const failingRuns = flagged.filter((c) => c.status === "fail").length
    findings.push({
      auditId,
      orgId: text.orgId,
      ruleId,
      kind: failingRuns > 0 ? "fail" : "inconclusive",
      rulesVersions: versions,
      area: text.area,
      severity: text.severity,
      title: text.title,
      checkTitle: text.checkTitle,
      owner,
      why: text.why,
      fix: text.fix,
      failingRuns,
      inconclusiveRuns: flagged.length - failingRuns,
      runIds: flagged.map((c) => c.runId),
    })
  }
  return findings
}
