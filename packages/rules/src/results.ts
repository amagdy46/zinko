import type { CheckResult, EvidenceRef } from "./types.js"

/** Evidence, when given, shows what the verdict rests on (a rule that classifies rather than checks). */
export const pass = (
  ruleId: string,
  message: string,
  evidence: readonly EvidenceRef[] = [],
): CheckResult => ({
  ruleId,
  status: "pass",
  message,
  evidence,
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

const joined = (list: readonly CheckResult[]) => list.map((r) => r.message).join("; ")

/**
 * One verdict from the verdicts of several arrivals (a journey that follows more than one link): any
 * failure wins, else anything unresolved is could not check, else pass. Evidence is every arrival's.
 */
export function combineArrivals(ruleId: string, results: readonly CheckResult[]): CheckResult {
  const [only] = results
  if (results.length === 1 && only !== undefined) return only
  const evidence = [
    ...new Map(
      results.flatMap((r) => r.evidence).map((ref) => [JSON.stringify(ref), ref]),
    ).values(),
  ]
  const of = (status: CheckResult["status"]) => results.filter((r) => r.status === status)
  const failed = of("fail")
  const unresolved = of("inconclusive")
  const cited = nonEmpty(evidence)
  if (failed.length > 0 && cited !== null)
    return fail(
      ruleId,
      unresolved.length === 0
        ? joined(failed)
        : `${joined(failed)}; and could not tell: ${joined(unresolved)}`,
      cited,
    )
  if (unresolved.length > 0) return inconclusive(ruleId, joined(unresolved), evidence)
  return pass(ruleId, joined(results), evidence)
}
