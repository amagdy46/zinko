import { useSyncExternalStore } from "react"

const isApple = () => /Mac|iPhone|iPad|iPod/.test(navigator.platform)

/** The label of the Find shortcut for this platform; the server and hydration use Ctrl. */
export function useFindShortcut(): string {
  return useSyncExternalStore(
    () => () => {},
    () => (isApple() ? "⌘K" : "Ctrl K"),
    () => "Ctrl K",
  )
}
