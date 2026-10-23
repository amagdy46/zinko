// Wraps `WebSocket` so a socket to a vendor host or a collection-shaped URL is refused before it
// connects. Runs in pages (patchright, whose own WebSocket routing never fires) and in dedicated
// workers (evaluated by the engine before the worker's first line). The engine replaces the
// placeholder with the vendor hosts and the collection endpoints; refused URLs go to the
// `__zinkoBlockedSocket` binding, or to a queue on `window.__zinkoSockets` the engine drains.
;((config) => {
  const BINDING = "__zinkoBlockedSocket"
  const QUEUE = "__zinkoSockets"
  const scope = globalThis
  const Native = scope.WebSocket
  if (typeof Native !== "function" || Object.hasOwn(Native, "__zinkoGuard")) return

  const refused = (target) =>
    config.hosts.some((host) => target.hostname === host || target.hostname.endsWith(`.${host}`)) ||
    config.endpoints.some(
      (endpoint) =>
        endpoint.methods.includes("GET") &&
        new RegExp(endpoint.path).test(target.pathname) &&
        Object.entries(endpoint.query).every(
          ([key, value]) => target.searchParams.get(key) === value,
        ),
    )

  const report = (href) => {
    try {
      scope[BINDING](href)
      return
    } catch {}
    let sink = scope
    try {
      if (scope.top && scope.top.location.href !== undefined) sink = scope.top
    } catch {}
    ;(sink[QUEUE] ||= []).push(href)
  }

  function WebSocket(url, protocols) {
    // Coerced once: what is checked is what the native constructor gets.
    const text = String(url)
    let target
    try {
      target = new URL(text, scope.location.href)
    } catch {
      return protocols === undefined ? new Native(text) : new Native(text, protocols)
    }
    if (refused(target)) {
      report(target.href)
      throw new DOMException("Blocked by blockVendorRequests", "SecurityError")
    }
    return protocols === undefined ? new Native(target.href) : new Native(target.href, protocols)
  }
  WebSocket.prototype = Native.prototype
  for (const name of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"]) WebSocket[name] = Native[name]
  Object.defineProperty(WebSocket, "__zinkoGuard", { value: true })
  Object.defineProperty(Native.prototype, "constructor", {
    value: WebSocket,
    writable: true,
    configurable: true,
  })
  scope.WebSocket = WebSocket
})(__ZINKO_SOCKET_CONFIG__)
