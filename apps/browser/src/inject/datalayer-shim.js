// Runs in every document before page scripts, under both engines. It records each
// `dataLayer.push` with the time it happened and helps the engine read consent, check the banner
// after the consent action and flush beacons.
// Entries go to the `__zinkoDataLayer` binding the engine exposes; if that is missing they wait
// in a queue the engine drains.
;(() => {
  if (Object.hasOwn(window, "__zinko")) return

  const BINDING = "__zinkoDataLayer"
  const TCF_API = "__tcfapi"
  const AUTOCONSENT = "__zinkoAutoconsent"
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
  // autoconsent counts any laid-out element as visible, so a banner that closes by fading out or
  // turning `visibility: hidden` (vanilla-cookieconsent does) would still count as shown. For the
  // check after the consent action an element must also be opaque, visible and on screen.
  const shownOnly = { opacityProperty: true, visibilityProperty: true }
  const onScreen = (element) => {
    if (!element.checkVisibility(shownOnly)) return false
    const box = element.getBoundingClientRect()
    return (
      box.width > 0 &&
      box.height > 0 &&
      box.bottom > 0 &&
      box.right > 0 &&
      box.top < window.innerHeight &&
      box.left < window.innerWidth
    )
  }
  function strictlyVisible(selector, check = "all") {
    const results = Array.from(this.elementSelector(selector), onScreen)
    if (check === "none") return results.every((result) => !result)
    if (results.length === 0) return false
    return check === "any" ? results.some(Boolean) : results.every(Boolean)
  }
  async function popupShown(instance, cmp) {
    const dom = instance.domActions
    const loose = dom.elementVisible
    dom.elementVisible = strictlyVisible
    try {
      return Boolean(await cmp.detectPopup())
    } catch {
      return null
    } finally {
      dom.elementVisible = loose
    }
  }
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
    // After the consent action: true while the banner of CMP `name` is still shown, false once it
    // is gone, null when that cannot be checked. Re-runs the CMP's own popup check on the instance
    // the engines name when they inject autoconsent: the one that acted, or in a document loaded
    // since (a CMP that saves the choice and reloads) a fresh one, once the page has loaded and the
    // CMP is detected in it.
    bannerShown: async (name) => {
      const instance = window[AUTOCONSENT]
      if (!instance) return null
      let cmp = instance.foundCmp?.name === name ? instance.foundCmp : null
      try {
        if (!cmp) {
          if (document.readyState !== "complete") return null
          cmp = instance.rules.find((rule) => rule.name === name)
          if (!cmp || !(await cmp.detectCmp())) return null
        }
      } catch {
        return null
      }
      return popupShown(instance, cmp)
    },
    // In a document loaded after the choice: true while the banner of CMP `name` is shown, false
    // when the CMP's own popup check finds none (also when the CMP leaves no markup at all once
    // consent is stored, which `bannerShown` would call undetected), null while the page loads or
    // when the check cannot run. The engines poll it, so a banner that appears late is still seen.
    bannerWatch: async (name) => {
      const instance = window[AUTOCONSENT]
      if (!instance || document.readyState !== "complete") return null
      const cmp = instance.rules.find((rule) => rule.name === name)
      if (!cmp) return null
      // Autoconsent's own visibility test: nothing is fading out in a document that just loaded,
      // and a banner whose wrapper has no box of its own (vanilla-cookieconsent) still counts.
      try {
        return Boolean(await cmp.detectPopup())
      } catch {
        return null
      }
    },
  }
  Object.defineProperty(window, "__zinko", { value: Object.freeze(helpers) })
})()
