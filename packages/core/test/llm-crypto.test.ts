import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { decryptSecret, encryptSecret, loadEncryptionKey } from "../src/llm-crypto"

const keyText = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))
const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

describe("llm-crypto", () => {
  it("round-trips a secret and never stores it in the clear", async () => {
    const key = await run(loadEncryptionKey(keyText))
    const sealed = await run(encryptSecret(key, "sk-secret-1234", "org_1"))
    expect(sealed).not.toContain("sk-secret")
    expect(sealed.startsWith("v1.")).toBe(true)
    expect(await run(decryptSecret(key, sealed, "org_1"))).toBe("sk-secret-1234")
  })

  it("uses a fresh IV each time", async () => {
    const key = await run(loadEncryptionKey(keyText))
    const [a, b] = await Promise.all([
      run(encryptSecret(key, "same", "org_1")),
      run(encryptSecret(key, "same", "org_1")),
    ])
    expect(a).not.toBe(b)
  })

  it("refuses a ciphertext moved to another organization or tampered with", async () => {
    const key = await run(loadEncryptionKey(keyText))
    const sealed = await run(encryptSecret(key, "sk-secret", "org_1"))
    expect(await run(Effect.flip(decryptSecret(key, sealed, "org_2")))).toMatchObject({
      _tag: "LlmError",
    })
    const parts = sealed.split(".")
    const tampered = `${parts[0]}.${parts[1]}.${btoa("x".repeat(24))}`
    expect(await run(Effect.flip(decryptSecret(key, tampered, "org_1")))).toMatchObject({
      _tag: "LlmError",
    })
  })

  it("rejects a missing, malformed or wrong-sized key at load time", async () => {
    const errors = await Promise.all(
      [undefined, "", "not base64!", btoa("short")].map((bad) =>
        run(Effect.flip(loadEncryptionKey(bad))),
      ),
    )
    for (const error of errors) expect(error).toMatchObject({ _tag: "LlmConfigError" })
  })
})
