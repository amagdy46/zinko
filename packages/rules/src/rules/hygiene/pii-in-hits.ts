import { distinct, documentRef, hitRef, vendorName } from "../../documents.js"
import { fail, nonEmpty, pass } from "../../results.js"
import type { DecodedHit, EvidenceRef, Rule } from "../../types.js"

const id = "hygiene.pii-in-hits"

// The domain is limited to host name characters, and image file names are left out, so a retina
// asset such as logo@2x.png is not read as an address.
const EMAIL =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?!(?:png|jpe?g|gif|svg|webp|avif)(?![A-Za-z0-9-]))[A-Za-z]{2,}(?![A-Za-z0-9-])/
/** `+` and 8 to 15 digits, single spaces or dashes allowed between them. */
const INTERNATIONAL_PHONE = /(?<![\w+])\+\d(?:[ -]?\d){7,14}(?!\d)/
/** A value that is only a phone number's characters, with 6 to 15 digits. */
const PHONE_LIKE = /^\+?[\d\s().-]+$/

/**
 * A parameter named for a phone number: a name token `tel` or `mobile`, or one containing `phone`
 * (`phone`, `user_phone`, `phoneNumber`, `telephone`). Tokens, not substrings, so `hotel` is not
 * `tel`.
 */
function isPhoneName(name: string): boolean {
  return name
    .split(/[^A-Za-z0-9]+|(?<=[a-z])(?=[A-Z])/)
    .map((token) => token.toLowerCase())
    .some((token) => token === "tel" || token === "mobile" || token.includes("phone"))
}

function isPhoneValue(value: string): boolean {
  const digits = value.replace(/\D/g, "").length
  return PHONE_LIKE.test(value.trim()) && digits >= 6 && digits <= 15
}

/** URL-decoded, twice at most, since page URLs travel encoded inside hit URLs. */
function decoded(text: string): string {
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

function queryEntries(url: string): [string, string][] {
  return URL.canParse(url) ? [...new URL(url).searchParams] : []
}

function emailIn(text: string): boolean {
  return EMAIL.test(decoded(text))
}

/** A phone number in a value, or in the query of a URL the value holds. */
function phoneIn(name: string, value: string): boolean {
  return (
    INTERNATIONAL_PHONE.test(value) ||
    (isPhoneName(name) && isPhoneValue(value)) ||
    queryEntries(value).some(([key, v]) => isPhoneName(key) && isPhoneValue(v))
  )
}

/** What in one hit looks like personal data: "an email address in GA4 page_location". */
function findingsIn(hit: DecodedHit): string[] {
  const vendor = vendorName(hit.vendor)
  const found: string[] = []
  for (const [key, raw] of Object.entries(hit.params)) {
    const value = decoded(String(raw))
    if (EMAIL.test(value)) found.push(`an email address in ${vendor} ${key}`)
    if (phoneIn(key, value)) found.push(`a phone number in ${vendor} ${key}`)
  }
  if (found.length > 0) return found
  // The raw request URL holds parameters no decoder surfaces.
  if (emailIn(hit.url)) found.push(`an email address in the ${vendor} request URL`)
  if (queryEntries(hit.url).some(([key, v]) => isPhoneName(key) && isPhoneValue(v)))
    found.push(`a phone number in the ${vendor} request URL`)
  return found
}

export const piiInHits: Rule = {
  id,
  area: "hygiene",
  severity: "critical",
  title: "Personal data sent to tracking vendors",
  why: "Google, Meta and TikTok forbid sending personal data such as email addresses and phone numbers in hits, and under the GDPR it is a transfer the visitor never agreed to. Google may delete the affected GA4 data, and the address ends up in the vendors' logs and reports. It usually comes from a URL that carries the address (a sign-up or newsletter form using GET, a link in an email) and is copied into page_location.",
  fix: [
    "Stop putting personal data in URLs: submit forms with POST, and do not add the email or phone to redirect or confirmation URLs.",
    "Until then, remove it before the tags read the URL: strip those query parameters from page_location (a GA4 config override or a tag manager variable) and from the URL the pixels send.",
    "For Meta and TikTok advanced matching, send the email and phone only as the hashed user data fields their pixels define, never as custom parameters.",
  ],
  evaluate(input) {
    const documents = input.capture.documents.filter((doc) =>
      [doc.url, ...doc.redirects].some(emailIn),
    )
    const hits = input.hits.flatMap((hit) => {
      const found = findingsIn(hit)
      return found.length === 0 ? [] : [{ hit, found }]
    })
    const evidence = nonEmpty<EvidenceRef>([
      ...documents.map((doc) => documentRef(doc.id)),
      ...hits.map(({ hit }) => hitRef(hit)),
    ])
    if (evidence === null)
      return pass(id, "no email address or phone number in the document URLs or the hits")
    const where = distinct([
      ...(documents.length > 0 ? ["an email address in the document URL"] : []),
      ...hits.flatMap(({ found }) => found),
    ]).join("; ")
    return fail(id, where, evidence)
  },
}
