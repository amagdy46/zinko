// Marketing tags for every fixture site. Reads window.zinkoConfig = { page, ...site flags }.
;(() => {
  const cfg = window.zinkoConfig
  const ID = {
    ga4: "G-ZINKO00001",
    meta: "100000000000001",
    ads: "AW-100000001",
    tiktok: "ZINKOTT0001",
  }
  const purchase = { transaction_id: "T-1001", value: 49.9, currency: "EUR" }
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
  gtag("config", ID.ga4)
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
    gtag("event", "purchase", purchase)
    gtag("event", "conversion", { send_to: ID.ads + "/ZinkoConv01", ...purchase })
    if (cfg.purchase === "twice") setTimeout(() => gtag("event", "purchase", purchase), 1000)
  }

  function runSnippet(src) {
    return new Promise((resolve) => {
      const script = document.createElement("script")
      script.src = src
      script.addEventListener("load", resolve)
      document.head.appendChild(script)
    })
  }

  let metaLoaded = false
  async function loadMeta() {
    if (metaLoaded) return
    metaLoaded = true
    await runSnippet("/_vendor/meta-pixel/snippet.js")
    window.fbq("init", ID.meta)
    window.fbq("track", "PageView")
    if (cfg.page === "product") window.fbq("track", "ViewContent", { currency: "EUR", value: 49.9 })
    if (cfg.page === "thank-you") {
      window.fbq("track", "Purchase", { value: purchase.value, currency: purchase.currency })
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
  }
})()
