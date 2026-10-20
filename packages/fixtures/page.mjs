const titles = { home: "Home", product: "Zinko mug", "thank-you": "Thank you" }

const escapeHtml = (text) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")

export function renderPage({ name, page, flags, query, gpcHeader }) {
  const base = `/${name}`
  const suffix = flags.keepQuery ? query : ""
  const nav = [
    `<a href="${base}/${suffix}">Home</a>`,
    `<a href="${base}/product${suffix}">Product</a>`,
    `<a href="${base}/thank-you${suffix}">Thank you</a>`,
  ].join(" | ")
  const config = JSON.stringify({ page, ...flags }).replaceAll("<", "\\u003c")
  const gpc =
    flags.gpcEcho && page === "home"
      ? `<p>Server saw <code id="gpc-header">Sec-GPC: ${escapeHtml(gpcHeader ?? "(not sent)")}</code></p>
    <p>Browser <code id="gpc-navigator">navigator.globalPrivacyControl === <span id="gpc-value">?</span></code></p>
    <script>document.getElementById("gpc-value").textContent = String(navigator.globalPrivacyControl)</script>`
      : ""
  const cmpHead = flags.cmp
    ? `<link rel="stylesheet" href="/_vendor/cookieconsent/cookieconsent.css">`
    : ""
  const cmpBody = flags.cmp
    ? `<script src="/_vendor/cookieconsent/cookieconsent.umd.js"></script>
  <script src="/_shared/consent.js"></script>`
    : ""

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${titles[page]} - ${name}</title>
  ${cmpHead}
  <script>window.zinkoConfig = ${config}</script>
  <script src="/_shared/tags.js"></script>
</head>
<body>
  <nav>${nav}</nav>
  <h1>${titles[page]}</h1>
  <p>Fixture site <strong>${name}</strong>.</p>
  ${gpc}
  ${cmpBody}
</body>
</html>
`
}
