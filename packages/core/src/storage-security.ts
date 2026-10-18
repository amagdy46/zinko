/**
 * Pure helpers for signed download URLs. They use only Web Crypto, so they run in Workers, Node
 * and tests. The signature is HMAC-SHA256 over `<key>\n<expires>`, hex encoded.
 */

/** A shorter secret is rejected when the Storage layer is built. */
export const MIN_SECRET_LENGTH = 32

const encoder = new TextEncoder()

const importKey = (secret: string, usage: "sign" | "verify") =>
  crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    usage,
  ])

const message = (key: string, expires: string) => encoder.encode(`${key}\n${expires}`)

const toHex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("")

const fromHex = (hex: string): Uint8Array<ArrayBuffer> | undefined => {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) return undefined
  return Uint8Array.from(hex.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16))
}

/** Unix seconds as plain digits, no sign, spaces or exponent. */
export const parseExpiry = (expires: string): number | undefined => {
  if (!/^\d+$/.test(expires)) return undefined
  const seconds = Number(expires)
  return Number.isSafeInteger(seconds) ? seconds : undefined
}

/**
 * Checks the shape of the `expires` and `signature` query parameters. `undefined` means the
 * request is malformed (answer 400), which is different from a well-formed but wrong signature (403).
 */
export const parseSignedParams = (
  expires: string | null,
  signature: string | null,
): { readonly expires: string; readonly signature: string } | undefined =>
  expires !== null &&
  signature !== null &&
  parseExpiry(expires) !== undefined &&
  /^[0-9a-f]{64}$/i.test(signature)
    ? { expires, signature }
    : undefined

/** Hex HMAC for `key` valid until `expires` (unix seconds). */
export const signPayload = async (secret: string, key: string, expires: string) =>
  toHex(await crypto.subtle.sign("HMAC", await importKey(secret, "sign"), message(key, expires)))

/** Constant-time check (`crypto.subtle.verify`); false for expired, malformed or wrong signatures. */
export const verifyPayload = async (
  secret: string,
  key: string,
  expires: string,
  signature: string,
  now: number = Date.now(),
): Promise<boolean> => {
  const seconds = parseExpiry(expires)
  const bytes = fromHex(signature)
  if (seconds === undefined || bytes === undefined || seconds * 1000 < now) return false
  return crypto.subtle.verify(
    "HMAC",
    await importKey(secret, "verify"),
    bytes,
    message(key, expires),
  )
}

/** Only these types render in the browser; everything else (HTML, SVG, ...) downloads. */
const inlineTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"])

/**
 * Response headers for a served object. Stored content is untrusted: never sniffed, never run as
 * a page, and shown inline only when it is a raster image.
 */
export const downloadHeaders = (
  key: string,
  contentType: string | undefined,
): Record<string, string> => {
  const type = (contentType ?? "application/octet-stream").split(";")[0]?.trim().toLowerCase()
  const inline = type !== undefined && inlineTypes.has(type)
  const name = (key.split("/").at(-1) ?? "file").replaceAll(/[^\w.-]/g, "_") || "file"
  return {
    "content-type": inline ? type : (contentType ?? "application/octet-stream"),
    "content-disposition": inline ? "inline" : `attachment; filename="${name}"`,
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "cache-control": "private, max-age=0",
  }
}
