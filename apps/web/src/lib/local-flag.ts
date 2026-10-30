import { useSyncExternalStore } from "react"

/** A yes/no choice kept in this browser only (no account state). Storage may be unavailable, so a failure reads as unset. */
export function setLocalFlag(key: string, on: boolean) {
  try {
    if (on) localStorage.setItem(key, "1")
    else localStorage.removeItem(key)
    window.dispatchEvent(new StorageEvent("storage", { key }))
  } catch {
    // storage is unavailable (private mode): the flag simply stays unset
  }
}

const subscribe = (notify: () => void) => {
  window.addEventListener("storage", notify)
  return () => window.removeEventListener("storage", notify)
}

export function useLocalFlag(key: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => {
      try {
        return localStorage.getItem(key) === "1"
      } catch {
        return false
      }
    },
    () => false,
  )
}
