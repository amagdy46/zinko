import { expect, it } from "vitest"
import {
  isMessageTooLarge,
  isValidRoomId,
  MAX_MESSAGE_BYTES,
  reconnectDelay,
} from "../src/realtime-limits"

it("accepts word and dash room ids up to 64 characters", () => {
  for (const id of ["demo", "room_1", "a-b", "x".repeat(64)]) expect(isValidRoomId(id)).toBe(true)
})

it("rejects empty, long, or unusual room ids", () => {
  for (const id of ["", "x".repeat(65), "a/b", "a b", "../x", "é", "a\n"])
    expect(isValidRoomId(id)).toBe(false)
})

it("measures message size in bytes, not characters", () => {
  expect(isMessageTooLarge("a".repeat(MAX_MESSAGE_BYTES))).toBe(false)
  expect(isMessageTooLarge("a".repeat(MAX_MESSAGE_BYTES + 1))).toBe(true)
  expect(isMessageTooLarge("é".repeat(MAX_MESSAGE_BYTES / 2 + 1))).toBe(true)
})

it("backs off exponentially, jittered, never past 30 seconds", () => {
  expect(reconnectDelay(0, () => 0)).toBe(500)
  expect(reconnectDelay(0, () => 1)).toBe(1000)
  expect(reconnectDelay(3, () => 1)).toBe(8000)
  expect(reconnectDelay(50, () => 1)).toBe(30_000)
  expect(reconnectDelay(50, () => 0)).toBe(15_000)
  for (let attempt = 0; attempt < 40; attempt++)
    expect(reconnectDelay(attempt)).toBeLessThanOrEqual(30_000)
})
