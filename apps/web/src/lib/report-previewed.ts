import { setLocalFlag, useLocalFlag } from "@/lib/local-flag"

const keyOf = (auditId: string) => `zinko:report-previewed:${auditId}`

/** Remembers, in this browser, that the consultant has seen the client view of an audit's report. */
export const markPreviewed = (auditId: string) => setLocalFlag(keyOf(auditId), true)

export const usePreviewed = (auditId: string) => useLocalFlag(keyOf(auditId))
