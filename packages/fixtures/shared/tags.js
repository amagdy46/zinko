// Marketing tags for every fixture site. Reads window.zinkoConfig = { page, ...site flags }.
;(() => {
  const cfg = window.zinkoConfig
  const ID = {
    ga4: "G-ZINKO00001",
    ga4Second: "G-ZINKO00002",
    meta: "100000000000001",
    ads: "AW-100000001",
    tiktok: "ZINKOTT0001",
  }
  const purchase = { transaction_id: "T-1001", value: 49.9, currency: cfg.currency }
  const trackedPurchase = cfg.purchaseOrderId
    ? purchase
    : { value: purchase.value, currency: purchase.currency }
  const denied = {
    ad_storage: "denied",
    analytics_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  }

  window.dataLayer = window.dataLayer || []
  function gtag() {
    window.dataLayer.push(arguments)
  }
  window.gtag = gtag

  if (cfg.consentDefault === "early")
    gtag("consent", "default", { ...denied, wait_for_update: 500 })
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
  if (cfg.locationOverride)
    ga4Config.page_location = "https://staging.shop.example" + location.pathname
  gtag("config", ID.ga4, ga4Config)
  if (cfg.secondGa4) gtag("config", ID.ga4Second)
  gtag("config", ID.ads, cfg.conversionLinker ? {} : { conversion_linker: false })
  if (cfg.consentDefault === "late") gtag("consent", "default", denied)

  if (cfg.page === "product") {
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
  if (cfg.page === "thank-you") {
    gtag("event", "purchase", trackedPurchase)
    gtag("event", "conversion", { send_to: ID.ads + "/ZinkoConv01", ...trackedPurchase })
    if (cfg.purchase === "twice") setTimeout(() => gtag("event", "purchase", trackedPurchase), 1000)
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
    if (cfg.page === "thank-you") {
      track("Purchase", { value: purchase.value, currency: purchase.currency })
    }
  }

  let tiktokLoaded = false
  async function loadTikTok() {
    if (tiktokLoaded) return
    tiktokLoaded = true
    await runSnippet("/_vendor/tiktok-pixel/snippet.js")
    if (cfg.page === "product") window.ttq.track("ViewContent", { currency: "EUR", value: 49.9 })
    if (cfg.page === "thank-you") {
      window.ttq.track("CompletePayment", { value: purchase.value, currency: purchase.currency })
    }
  }

  if (cfg.meta === "immediate") void loadMeta()
  if (cfg.tiktok === "immediate") void loadTikTok()

  window.zinkoConsent = (analytics, marketing) => {
    gtag("consent", "update", {
      analytics_storage: analytics ? "granted" : "denied",
      ad_storage: marketing ? "granted" : "denied",
      ad_user_data: marketing ? "granted" : "denied",
      ad_personalization: marketing ? "granted" : "denied",
    })
    if (cfg.meta === "consent" && marketing) void loadMeta()
    if (cfg.meta === "delayed") setTimeout(() => void loadMeta(), 3000)
    if (cfg.tiktok === "consent" && marketing) void loadTikTok()
    if (cfg.tiktok === "after-choice") void loadTikTok()
    // An SPA "clean URL": once the tags have read the click IDs, the query string goes, so the
    // tab's history (which gtag reads the gclid back from) no longer holds it either.
    if (cfg.cleanUrl) setTimeout(() => history.replaceState(null, "", location.pathname), 2500)
  }
})()
