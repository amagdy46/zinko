import { expect, it } from "vitest"
import {
  downloadHeaders,
  parseSignedParams,
  signPayload,
  verifyPayload,
} from "../src/storage-security"

const secret = "0123456789abcdef0123456789abcdef"
const future = String(Math.floor(Date.now() / 1000) + 600)
const past = String(Math.floor(Date.now() / 1000) - 600)

it("accepts a fresh signature", async () => {
  const signature = await signPayload(secret, "a/b.txt", future)
  expect(signature).toMatch(/^[0-9a-f]{64}$/)
  expect(await verifyPayload(secret, "a/b.txt", future, signature)).toBe(true)
})

it("rejects tampered keys, expiry, secrets and signatures", async () => {
  const signature = await signPayload(secret, "a.txt", future)
  expect(await verifyPayload(secret, "b.txt", future, signature)).toBe(false)
  expect(await verifyPayload(secret, "a.txt", String(Number(future) + 1), signature)).toBe(false)
  expect(await verifyPayload("x".repeat(32), "a.txt", future, signature)).toBe(false)
  const flipped = (signature.startsWith("0") ? "1" : "0") + signature.slice(1)
  expect(await verifyPayload(secret, "a.txt", future, flipped)).toBe(false)
})

it("rejects expired signatures even when they are valid", async () => {
  const signature = await signPayload(secret, "a.txt", past)
  expect(await verifyPayload(secret, "a.txt", past, signature)).toBe(false)
})

it("rejects malformed input without throwing", async () => {
  const cases = [
    ["1e12", "00"],
    ["-5", "00"],
    ["12 ", "zz"],
    [future, "not-hex"],
    [future, "abc"],
    [future, ""],
  ] as const
  const results = await Promise.all(
    cases.map(([expires, signature]) => verifyPayload(secret, "a.txt", expires, signature)),
  )
  expect(results).toEqual(cases.map(() => false))
})

it("parseSignedParams separates malformed (400) from merely wrong (403)", async () => {
  const signature = await signPayload(secret, "a.txt", future)
  expect(parseSignedParams(future, signature)).toEqual({ expires: future, signature })
  expect(parseSignedParams(null, signature)).toBeUndefined()
  expect(parseSignedParams(future, null)).toBeUndefined()
  expect(parseSignedParams("1e9", signature)).toBeUndefined()
  expect(parseSignedParams(future, "short")).toBeUndefined()
})

it("serves everything as an attachment except raster images", () => {
  const html = downloadHeaders("x/evil.html", "text/html")
  expect(html["content-disposition"]).toBe('attachment; filename="evil.html"')
  expect(html["x-content-type-options"]).toBe("nosniff")
  expect(downloadHeaders("logo.svg", "image/svg+xml")["content-disposition"]).toContain(
    "attachment",
  )
  expect(downloadHeaders("a.png", "image/png")["content-disposition"]).toBe("inline")
  expect(downloadHeaders("a.png", "image/png; charset=binary")["content-disposition"]).toBe(
    "inline",
  )
  expect(downloadHeaders('we"ird\r\n.bin', undefined)["content-disposition"]).toBe(
    'attachment; filename="we_ird__.bin"',
  )
})
