import { Data, Effect } from "effect"
import { LlmError } from "./llm"

/** `LLM_ENCRYPTION_KEY` is missing or not 32 base64-encoded bytes, so the Llm layer can't be built. */
export class LlmConfigError extends Data.TaggedError("LlmConfigError")<{
  readonly message: string
}> {}

const VERSION = "v1"
const KEY_BYTES = 32
const IV_BYTES = 12

const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes))
const fromBase64 = (text: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(text), (c) => c.charCodeAt(0))

const invalidKey = new LlmConfigError({
  message:
    "LLM_ENCRYPTION_KEY must be 32 random bytes, base64 encoded. Generate one with `openssl rand -base64 32` and set it as a secret (.dev.vars locally).",
})

/** Imports the AES-GCM key from `LLM_ENCRYPTION_KEY`; fails with a clear message when it is unusable. */
export const loadEncryptionKey = (
  value: string | undefined,
): Effect.Effect<CryptoKey, LlmConfigError> =>
  Effect.gen(function* () {
    const text = (value ?? "").trim()
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return yield* invalidKey
    const raw = yield* Effect.try({ try: () => fromBase64(text), catch: () => invalidKey })
    if (raw.length !== KEY_BYTES) return yield* invalidKey
    return yield* Effect.promise(() =>
      crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]),
    )
  })

/**
 * AES-GCM with a random IV. `context` (the organization id) is authenticated but not stored, so a
 * ciphertext copied to another organization's row fails to decrypt. Output: `v1.<iv>.<ciphertext>`.
 */
export const encryptSecret = (
  key: CryptoKey,
  plaintext: string,
  context: string,
): Effect.Effect<string, LlmError> =>
  Effect.tryPromise({
    try: async () => {
      const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
      const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(context) },
        key,
        new TextEncoder().encode(plaintext),
      )
      return `${VERSION}.${toBase64(iv)}.${toBase64(new Uint8Array(encrypted))}`
    },
    catch: (cause) => new LlmError({ operation: "encrypt", cause }),
  })

export const decryptSecret = (
  key: CryptoKey,
  payload: string,
  context: string,
): Effect.Effect<string, LlmError> =>
  Effect.tryPromise({
    try: async () => {
      const [version, iv, data] = payload.split(".")
      if (version !== VERSION || iv === undefined || data === undefined)
        throw new Error("unknown ciphertext format")
      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: fromBase64(iv), additionalData: new TextEncoder().encode(context) },
        key,
        fromBase64(data),
      )
      return new TextDecoder().decode(decrypted)
    },
    catch: (cause) => new LlmError({ operation: "decrypt", cause }),
  })
