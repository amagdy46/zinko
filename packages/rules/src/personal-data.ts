/** Anything shaped like `local@domain`; `isEmail` decides whether it is an address. */
const EMAIL_CANDIDATE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g
const HOST_NAME = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.([A-Za-z]{2,})$/
const ASSET_EXTENSION = /^(?:png|jpe?g|gif|webp|svg|avif|ico)$/i

/**
 * An email address: a candidate whose whole domain is a host name ending in a letter TLD. A file
 * name whose last extension is an asset's is not one, so retina assets such as `logo@2x.png` or
 * `logo@2x.dark.PNG` are left out.
 */
function isEmail(candidate: string): boolean {
  const domain = candidate.slice(candidate.indexOf("@") + 1).replace(/[.-]+$/, "")
  const tld = HOST_NAME.exec(domain)?.[1]
  return tld !== undefined && !ASSET_EXTENSION.test(tld)
}

export function hasEmail(text: string): boolean {
  for (const [candidate] of text.matchAll(EMAIL_CANDIDATE)) if (isEmail(candidate)) return true
  return false
}

/** `+` and 8 to 15 digits, single spaces or dashes allowed between them. */
export const INTERNATIONAL_PHONE = /(?<![\w+])\+\d(?:[ -]?\d){7,14}(?!\d)/

/** URL-decoded, twice at most, since page URLs travel encoded inside hit URLs. */
export function decoded(text: string): string {
  let current = text
  for (let round = 0; round < 2; round += 1) {
    let next: string
    try {
      next = decodeURIComponent(current)
    } catch {
      return current
    }
    if (next === current) return current
    current = next
  }
  return current
}

/**
 * The text with email addresses and international phone numbers replaced, after decoding it the
 * way `hygiene.pii-in-hits` does (an encoded address is found, and the result is the decoded text).
 * It sees the text alone: a domestic number, which the rule recognises only by its parameter's
 * name, is not found, and neither is a name or a token.
 */
export function scrubPersonalData(text: string): string {
  return decoded(text)
    .replace(EMAIL_CANDIDATE, (candidate) => (isEmail(candidate) ? "[email]" : candidate))
    .replace(new RegExp(INTERNATIONAL_PHONE, "g"), "[phone]")
}
