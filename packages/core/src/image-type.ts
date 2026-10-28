export type ImageType = "image/png" | "image/jpeg" | "image/webp"

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0) =>
  signature.every((byte, index) => bytes[offset + index] === byte)

/**
 * The image type named by the first bytes of a file, or `undefined` when they are not a PNG, a JPEG
 * or a WebP. Never trust a client's content type or file name: only the bytes decide.
 */
export function sniffImageType(bytes: Uint8Array): ImageType | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png"
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return "image/webp"
  return undefined
}
