// Starts the cookie banner (vanilla-cookieconsent) and reports the visitor's choice to tags.js.
// `cmpDelay` starts it that many ms after load, like a CMP the page fetches late.
setTimeout(() => runBanner(), window.zinkoConfig.cmpDelay)

function runBanner() {
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
    onConsent: () => reportConsent(),
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
    window.CookieConsent.acceptedCategory("marketing"),
  )
}
