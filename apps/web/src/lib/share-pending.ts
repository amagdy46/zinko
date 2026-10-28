/**
 * Calls with the same arguments made while one is still pending share its promise. React runs
 * every mount effect twice in development (StrictMode), and two panes can ask for the same thing
 * at once; a settled call is not kept, so a later call asks the server again.
 */
export function sharePending<Args, Result>(
  call: (args: Args) => Promise<Result>,
): (args: Args) => Promise<Result> {
  const pending = new Map<string, Promise<Result>>()
  return (args) => {
    const key = JSON.stringify(args) ?? ""
    const existing = pending.get(key)
    if (existing !== undefined) return existing
    const started = call(args).finally(() => pending.delete(key))
    pending.set(key, started)
    return started
  }
}
