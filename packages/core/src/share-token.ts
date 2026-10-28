const PREFIX = "zr1_"
const SHAPE = /^zr1_[A-Za-z0-9_-]{43}$/

const toHex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("")

/** A new share token: `zr1_` and 32 random bytes (256 bits) as 43 base64url characters. */
export function generateShareToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const text = btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "")
  return PREFIX + text
}

/** Hex SHA-256 of a token: the only form that is stored. */
export async function hashShareToken(token: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))
}

/** Whether a string has the shape of a token, checked before any database access. */
export function looksLikeShareToken(value: string): boolean {
  return SHAPE.test(value)
}
