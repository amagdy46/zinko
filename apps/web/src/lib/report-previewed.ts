import { useSyncExternalStore } from "react"

const keyOf = (auditId: string) => `zinko:report-previewed:${auditId}`

/** Remembers, in this browser, that the consultant has seen the client view of an audit's report. */
export function markPreviewed(auditId: string) {
  try {
    localStorage.setItem(keyOf(auditId), "1")
    window.dispatchEvent(new StorageEvent("storage", { key: keyOf(auditId) }))
  } catch {
    // storage is unavailable (private mode): the step simply stays open
  }
}

const subscribe = (notify: () => void) => {
  window.addEventListener("storage", notify)
  return () => window.removeEventListener("storage", notify)
}

export function usePreviewed(auditId: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => {
      try {
        return localStorage.getItem(keyOf(auditId)) === "1"
      } catch {
        return false
      }
    },
    () => false,
  )
}
