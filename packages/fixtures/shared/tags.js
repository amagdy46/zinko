// Marketing tags for every fixture site. Reads window.zinkoConfig = { page, ...site flags }.
;(() => {
  const cfg = window.zinkoConfig
  const ID = {
    ga4: cfg.ga4Id ?? "G-ZINKO00001",
    ga4Second: "G-ZINKO00002",
    meta: "100000000000001",
    ads: "AW-100000001",
    tiktok: "ZINKOTT0001",
    gtm: "GTM-ZINKO01",
  }
  // "new-order": a reload of /thank-you is tracked as a different order (a regenerated id)
  const orderKey = "zinko-tracked-order"
  const orderId =
    cfg.purchaseOnReload === "new-order" && sessionStorage.getItem(orderKey) !== null
      ? "T-1002"
      : "T-1001"
  const purchase = { transaction_id: orderId, value: 49.9, currency: cfg.currency }
  const trackedPurchase = cfg.purchaseOrderId
    ? purchase
    : { value: purchase.value, currency: purchase.currency }
  // A thank-you page that remembers the order it tracked (as a correct site does), so a reload of it
  // sends nothing again; "every-load" is the bug.
  const trackedBefore =
    cfg.page === "thank-you" &&
    cfg.purchaseOnReload === "guarded" &&
    sessionStorage.getItem(orderKey) === (trackedPurchase.transaction_id ?? "(none)")
  if (cfg.page === "thank-you")
    sessionStorage.setItem(orderKey, trackedPurchase.transaction_id ?? "(none)")
  const denied = {
    ad_storage: "denied",
    analytics_storage: "denied",
    ...(cfg.consentModeV2 && { ad_user_data: "denied", ad_personalization: "denied" }),
  }

  // the host a link on this page leads to (see page.mjs), for the cross-domain linker
  const [hostName = ""] = location.host.split(":")
  const isSource = hostName === "localhost" || hostName.startsWith("www.")
  const otherHost = (() => {
    if (hostName.startsWith("www.")) return "checkout." + hostName.slice(4)
    if (hostName.startsWith("checkout.")) return "www." + hostName.slice(9)
    return hostName === "localhost" ? "127.0.0.1" : "localhost"
  })()

  window.dataLayer = window.dataLayer || []
  function gtag() {
    window.dataLayer.push(arguments)
  }
  window.gtag = gtag

  if (cfg.consentDefault === "early")
    gtag("consent", "default", { ...denied, wait_for_update: 500 })
  if (cfg.consentDefault === "granted")
    gtag("consent", "default", {
      ad_storage: "granted",
      analytics_storage: "granted",
      ...(cfg.consentModeV2 && { ad_user_data: "granted", ad_personalization: "granted" }),
    })
  let googleStarted = false
  // Basic Consent Mode: the Google tag does not load until the visitor accepts something.
  function startGoogle() {
    if (googleStarted) return
    googleStarted = true
    const gtagScript = document.createElement("script")
    gtagScript.async = true
    gtagScript.src = "https://www.googletagmanager.com/gtag/js?id=" + ID.ga4
    document.head.appendChild(gtagScript)
    gtag("js", new Date())
    if (cfg.piiInUrl) {
      const url = new URL(location.href)
      url.searchParams.set("email", "jane.doe@example.com")
      history.replaceState(null, "", url.search)
    }
    const ga4Config = {}
    if (!cfg.ga4PageView) ga4Config.send_page_view = false
    if (cfg.sgtm) ga4Config.transport_url = location.origin
    // The Google tag gateway keeps measurement under one first-party path; gtag appends /g/collect
    if (cfg.ga4Collector === "gateway") ga4Config.transport_url = location.origin + "/metrics"
    if (cfg.locationOverride)
      ga4Config.page_location = "https://staging.shop.example" + location.pathname
    if (cfg.debugLeak) {
      ga4Config.debug_mode = true
      // the snippet GTM gives for a preview environment, left on the page after testing
      void runSnippet(
        "https://www.googletagmanager.com/gtm.js?id=" +
          ID.gtm +
          "&gtm_auth=ZinkoPreviewAuth01&gtm_preview=env-3&gtm_cookies_win=x",
      )
    }
    if (cfg.linker !== "none")
      ga4Config.linker = {
        domains: [otherHost],
        ...(cfg.linker === "no-accept" ? { accept_incoming: false } : {}),
      }
    gtag("config", ID.ga4, ga4Config)
    if (cfg.secondGa4 === true || (cfg.secondGa4 === "source" && isSource))
      gtag("config", ID.ga4Second, cfg.linker === "first-only" ? { cookie_prefix: "s2" } : {})
    gtag("config", ID.ads, cfg.conversionLinker ? {} : { conversion_linker: false })
    if (cfg.consentDefault === "late") gtag("consent", "default", denied)

    if (cfg.page === "product" && cfg.productViewItem !== false) {
      gtag("event", "view_item", {
        currency: "EUR",
        value: 49.9,
        items: [{ item_id: "SKU-1", item_name: "Zinko mug", price: 49.9 }],
      })
    }
    if (cfg.page === "home" && cfg.homeBatch) {
      gtag("event", "view_promotion", { promotion_id: "P1" })
      gtag("event", "view_item_list", { item_list_id: "featured" })
      gtag("event", "select_promotion", { promotion_id: "P1" })
    }
    if (cfg.page === "thank-you" && !trackedBefore) {
      gtag("event", "purchase", trackedPurchase)
      gtag("event", "conversion", { send_to: ID.ads + "/ZinkoConv01", ...trackedPurchase })
      if (cfg.purchase === "twice")
        setTimeout(() => gtag("event", "purchase", trackedPurchase), 1000)
    }
  }
  if (cfg.googleLoad === "immediate") startGoogle()
  if (cfg.regionFlip) {
    setTimeout(
      () =>
        gtag("consent", "update", {
          ad_storage: "granted",
          analytics_storage: "granted",
          ad_user_data: "granted",
          ad_personalization: "granted",
        }),
      3000,
    )
  }

  function runSnippet(src) {
    return new Promise((resolve) => {
      const script = document.createElement("script")
      script.src = src
      script.addEventListener("load", resolve)
      document.head.appendChild(script)
    })
  }

  async function installMeta(query = "") {
    await runSnippet("/_vendor/meta-pixel/snippet.js" + query)
    window.fbq("init", ID.meta)
  }

  // one per document load, so a journey that revisits a page does not repeat an event id
  const documentNonce = Math.random().toString(36).slice(2, 8)

  function metaEventId(event, sequence) {
    if (cfg.metaEventId === "none") return undefined
    if (cfg.metaEventId === "shared") return "evt-1"
    return cfg.page + "-" + event + "-" + sequence + "-" + documentNonce
  }

  let metaLoaded = false
  async function loadMeta() {
    if (metaLoaded) return
    metaLoaded = true
    // The real pixel never writes _fbc for this unregistered pixel id (its requests carry coo=false),
    // so a landing with an fbclid would always look like a lost click ID; write what it would.
    const fbclid = new URLSearchParams(location.search).get("fbclid")
    if (fbclid) document.cookie = "_fbc=fb.1.1700000000000." + fbclid + "; path=/; max-age=7776000"
    await installMeta()
    let sequence = 0
    const track = (event, params) => {
      sequence += 1
      const eventId = metaEventId(event, sequence)
      window.fbq("track", event, params, eventId ? { eventID: eventId } : undefined)
    }
    track("PageView")
    if (cfg.metaInit === "twice") {
      // a second install (for example a plugin plus a tag manager) starts the pixel again
      await new Promise((resolve) => {
        const timer = setInterval(() => {
          if (window.fbq.callMethod) {
            clearInterval(timer)
            resolve()
          }
        }, 50)
      })
      await new Promise((resolve) => setTimeout(resolve, 1000))
      delete window.fbq
      delete window["_fbq"]
      await installMeta("?copy=2")
      track("PageView")
    }
    if (cfg.page === "product") track("ViewContent", { currency: "EUR", value: 49.9 })
    if (cfg.page === "product" && cfg.metaEventId === "shared") {
      // two different add-to-carts under one id: Meta keeps the first and drops the second
      track("AddToCart", { content_ids: ["SKU-1"], currency: "EUR", value: 49.9 })
      track("AddToCart", { content_ids: ["SKU-2"], currency: "EUR", value: 19.9 })
    }
    if (cfg.page === "thank-you" && !trackedBefore) {
      track("Purchase", { value: purchase.value, currency: purchase.currency })
    }
  }

  let tiktokLoaded = false
  async function loadTikTok() {
    if (tiktokLoaded) return
    tiktokLoaded = true
    await runSnippet("/_vendor/tiktok-pixel/snippet.js")
    const track = (event, params) =>
      window.ttq.track(
        event,
        params,
        cfg.tiktokEventId === "none"
          ? undefined
          : { event_id: cfg.page + "-" + event + "-" + documentNonce },
      )
    if (cfg.page === "product") track("ViewContent", { currency: "EUR", value: 49.9 })
    if (cfg.page === "thank-you" && !trackedBefore) {
      track("CompletePayment", { value: purchase.value, currency: purchase.currency })
    }
  }

  if (cfg.meta === "immediate") void loadMeta()
  if (cfg.tiktok === "immediate") void loadTikTok()

  // A second GA4 sender next to gtag: a plugin or a second container posting the same events to the
  // site's own collector, shaped like a server-side GTM or tag gateway request.
  if (cfg.ga4Collector === "both") {
    setTimeout(() => {
      const params = new URLSearchParams({
        v: "2",
        tid: ID.ga4,
        cid: "1111111111.1700000000",
        gcs: "G100",
        dl: location.origin + location.pathname,
        en: "page_view",
      })
      const queries = [params.toString()]
      if (cfg.page === "thank-you") {
        params.set("en", "purchase")
        params.set("ep.transaction_id", purchase.transaction_id)
        params.set("epn.value", String(purchase.value))
        params.set("cu", purchase.currency)
        queries.push(params.toString())
      }
      for (const query of queries)
        void fetch("/metrics/g/collect?" + query, { method: "POST", keepalive: true })
    }, 1200)
  }

  // One request that contradicts itself (gcs grants, gcd denies), only after a reload, sent just
  // after the page is hidden so it is the last thing the tags say about consent
  if (cfg.conflictOnReload && performance.getEntriesByType("navigation")[0]?.type === "reload") {
    document.addEventListener(
      "visibilitychange",
      () => {
        if (!document.hidden) return
        setTimeout(() => {
          const params = new URLSearchParams({
            v: "2",
            tid: ID.ga4,
            cid: "1111111111.1700000000",
            gcs: "G111",
            gcd: "13q3q3q3q5l1",
            dl: location.origin + location.pathname,
            en: "page_view",
          })
          void fetch("/metrics/g/collect?" + params, { method: "POST", keepalive: true })
        }, 100)
      },
      { once: true },
    )
  }

  window.zinkoConsent = (analytics, marketing) => {
    const marketingState = marketing ? "granted" : "denied"
    gtag("consent", "update", {
      analytics_storage: analytics ? "granted" : "denied",
      ad_storage: marketingState,
      ...(cfg.consentModeV2 && {
        ad_user_data: marketingState,
        ad_personalization: marketingState,
      }),
    })
    if (analytics || marketing) startGoogle()
    if (cfg.meta === "consent" && marketing) void loadMeta()
    if (cfg.meta === "delayed") setTimeout(() => void loadMeta(), 3000)
    if (cfg.tiktok === "consent" && marketing) void loadTikTok()
    if (cfg.tiktok === "after-choice") void loadTikTok()
    // An SPA "clean URL": once the tags have read the click IDs, the query string goes, so the
    // tab's history (which gtag reads the gclid back from) no longer holds it either.
    if (cfg.cleanUrl) setTimeout(() => history.replaceState(null, "", location.pathname), 2500)
  }
})()
