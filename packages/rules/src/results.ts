import type { CheckResult, EvidenceRef } from "./types.js"

export const pass = (ruleId: string, message: string): CheckResult => ({
  ruleId,
  status: "pass",
  message,
  evidence: [],
})

/** A failing check always cites evidence, so the list cannot be empty. */
export const fail = (
  ruleId: string,
  message: string,
  evidence: readonly [EvidenceRef, ...EvidenceRef[]],
): CheckResult => ({ ruleId, status: "fail", message, evidence })

/** Evidence, when given, shows what the rule saw but could not judge. */
export const inconclusive = (
  ruleId: string,
  message: string,
  evidence: readonly EvidenceRef[] = [],
): CheckResult => ({ ruleId, status: "inconclusive", message, evidence })

export const notApplicable = (ruleId: string, message: string): CheckResult => ({
  ruleId,
  status: "not_applicable",
  message,
  evidence: [],
})

/** The list as a non-empty tuple, or `null` when it is empty. */
export function nonEmpty<T>(list: readonly T[]): readonly [T, ...T[]] | null {
  const [first, ...rest] = list
  return first === undefined ? null : [first, ...rest]
}
