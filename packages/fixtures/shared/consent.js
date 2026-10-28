// Starts the cookie banner (vanilla-cookieconsent) and reports the visitor's choice to tags.js.
// `cmpDelay` starts it that many ms after load, like a CMP the page fetches late.
setTimeout(() => runBanner(), window.zinkoConfig.cmpDelay)

function runBanner() {
  // consent-not-persisted: the previous document's choice is forgotten before the library reads it
  if (!window.zinkoConfig.consentPersist) document.cookie = "cc_cookie=; Max-Age=0; path=/"
  if (window.zinkoConfig.ghostBanner && document.cookie.includes("cc_cookie=")) addGhostBanner()
  window.CookieConsent.run({
    // headless captures set navigator.webdriver; the banner must still show
    hideFromBots: false,
    categories: {
      necessary: { enabled: true, readOnly: true },
      analytics: {},
      marketing: {},
    },
    guiOptions: {
      consentModal: { layout: "box", position: "bottom right" },
    },
    // onConsent also fires on every load while a stored choice is valid; onFirstConsent only once
    onFirstConsent: () => {
      if (window.zinkoConfig.consentRestore === "never") reportConsent()
    },
    onConsent: () => {
      if (window.zinkoConfig.consentRestore === "update") reportConsent()
    },
    onChange: () => reportConsent(),
    language: {
      default: "en",
      translations: {
        en: {
          consentModal: {
            title: "We use cookies",
            description: "Fixture banner: analytics and marketing tags wait for your choice.",
            acceptAllBtn: "Accept all",
            acceptNecessaryBtn: "Reject all",
            showPreferencesBtn: "Manage preferences",
          },
          preferencesModal: {
            title: "Cookie preferences",
            acceptAllBtn: "Accept all",
            acceptNecessaryBtn: "Reject all",
            savePreferencesBtn: "Save preferences",
            sections: [
              { title: "Strictly necessary", linkedCategory: "necessary" },
              { title: "Analytics", linkedCategory: "analytics" },
              { title: "Marketing", linkedCategory: "marketing" },
            ],
          },
        },
      },
    },
  })
}

function reportConsent() {
  window.zinkoConsent(
    window.CookieConsent.acceptedCategory("analytics"),
    window.zinkoConfig.acceptGrants === "all" && window.CookieConsent.acceptedCategory("marketing"),
  )
}

// consent-ghost-banner: the markup of a banner the visitor cannot see
function addGhostBanner() {
  const ghost = document.createElement("div")
  ghost.id = "cc-main"
  ghost.innerHTML =
    '<div class="cm-wrapper"><div class="cm" style="visibility:hidden;position:fixed;right:16px;bottom:16px;width:300px;height:200px">We use cookies</div></div>'
  document.body.append(ghost)
}
