// Runs in every document before page scripts, under both engines. It records each
// `dataLayer.push` with the time it happened and helps the engine read consent and flush beacons.
// Entries go to the `__zinkoDataLayer` binding the engine exposes; if that is missing they wait
// in a queue the engine drains.
;(() => {
  if (Object.hasOwn(window, "__zinko")) return

  const BINDING = "__zinkoDataLayer"
  const TCF_API = "__tcfapi"
  const MAX_ENTRIES = 1000
  const MAX_DEPTH = 10
  const MAX_STRING = 8 * 1024
  const MAX_ENTRY = 64 * 1024
  const timeOrigin = performance.timeOrigin
  const now = performance.now.bind(performance)
  const objectKeys = Object.keys
  const isArray = Array.isArray
  const objectProto = Object.prototype
  const isArguments = (value) => objectProto.toString.call(value) === "[object Arguments]"
  const queue = []
  let recorded = 0
  let truncated = false
  let clipped = false

  // Page values become JSON: gtag pushes `Arguments`, and pages push DOM nodes, functions and cycles.
  const normalize = (value) => {
    const seen = new Set()
    const walk = (item, depth) => {
      if (item === undefined || item === null) return null
      switch (typeof item) {
        case "function":
          return "[function]"
        case "symbol":
          return "[symbol]"
        case "number":
          return Number.isFinite(item) ? item : String(item)
        case "bigint":
          return String(item)
        case "string":
          if (item.length <= MAX_STRING) return item
          clipped = true
          return item.slice(0, MAX_STRING)
        case "boolean":
          return item
        default:
          break
      }
      if (depth >= MAX_DEPTH) return "[truncated]"
      if (seen.has(item)) return "[circular]"
      seen.add(item)
      if (isArray(item) || isArguments(item))
        return Array.from(item, (entry) => walk(entry, depth + 1))
      if (item instanceof Date) return Number.isNaN(item.getTime()) ? null : item.toISOString()
      if (item === window || (typeof Node === "function" && item instanceof Node)) return "[dom]"
      const out = {}
      for (const key of objectKeys(item)) {
        try {
          out[key] = walk(item[key], depth + 1)
        } catch {
          out[key] = "[unreadable]"
        }
      }
      return out
    }
    return walk(value, 0)
  }

  const send = (entry) => {
    const binding = window[BINDING]
    if (typeof binding !== "function") {
      queue.push(entry)
      return
    }
    const pending = binding(entry)
    if (pending && typeof pending.catch === "function") pending.catch(() => queue.push(entry))
  }

  // Tells the engine once that a limit cut something, so the result is marked `truncated`.
  let reported = false
  const reportTruncated = () => {
    if (reported) return
    reported = true
    send({ truncated: true })
  }

  const record = (value) => {
    if (truncated) return
    if (recorded >= MAX_ENTRIES) {
      truncated = true
      reportTruncated()
      return
    }
    recorded += 1
    let normalized = normalize(value)
    if (JSON.stringify(normalized).length > MAX_ENTRY) {
      clipped = true
      normalized = "[truncated]"
    }
    if (clipped) reportTruncated()
    send({ at: Math.round(timeOrigin + now()), value: normalized })
  }

  // gtag and GTM replace `push` with a function that calls the one they found, so pushes made
  // after they load still pass through this wrapper.
  const wrapped = new WeakSet()
  const install = (list) => {
    if (!isArray(list) || wrapped.has(list)) return list
    wrapped.add(list)
    const inner = list.push
    Object.defineProperty(list, "push", {
      configurable: true,
      enumerable: false,
      writable: true,
      value: function push(...items) {
        for (const item of items) record(item)
        return inner.apply(this, items)
      },
    })
    for (const item of list) record(item)
    return list
  }

  let dataLayer = install([])
  Object.defineProperty(window, "dataLayer", {
    configurable: true,
    enumerable: true,
    get: () => dataLayer,
    set: (value) => {
      dataLayer = install(value)
    },
  })

  const hiddenProps = ["visibilityState", "hidden"]
  const helpers = {
    normalize,
    drain: () => queue.splice(0),
    // The TCF v2 API answers asynchronously, or never when no CMP implements it.
    tcf: () =>
      new Promise((resolve) => {
        const tcfapi = window[TCF_API]
        if (typeof tcfapi !== "function") return resolve(null)
        const timer = setTimeout(() => resolve(null), 1000)
        try {
          tcfapi("getTCData", 2, (data, success) => {
            clearTimeout(timer)
            resolve(success ? normalize(data) : null)
          })
        } catch {
          clearTimeout(timer)
          resolve(null)
        }
      }),
    // What a tab switch or close looks like to the page: gtag flushes its pending batch on it.
    hide: () => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" })
      Object.defineProperty(document, "hidden", { configurable: true, value: true })
      document.dispatchEvent(new Event("visibilitychange"))
      window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }))
    },
    show: () => {
      for (const prop of hiddenProps) delete document[prop]
      document.dispatchEvent(new Event("visibilitychange"))
    },
  }
  Object.defineProperty(window, "__zinko", { value: Object.freeze(helpers) })
})()
