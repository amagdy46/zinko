/**
 * Limits and pure helpers shared by the audit room (server) and `useAuditRoom` (browser). No
 * imports, so the client bundle stays free of Effect.
 */

/** Audit ids are UUIDs; anything else never reaches the database or the room. */
const AUDIT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isAuditId = (id: string): boolean => AUDIT_ID_PATTERN.test(id)

/** Most browsers connected to one audit room at a time. */
export const MAX_ROOM_CONNECTIONS = 50

const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 30_000

/**
 * Milliseconds to wait before reconnect number `attempt` (0 for the first): exponential from 1 s,
 * capped at 30 s, with half of it randomised so dropped clients don't all return at once.
 */
export const reconnectDelay = (attempt: number, random: () => number = Math.random): number => {
  const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempt))
  return Math.round(ceiling / 2 + (random() * ceiling) / 2)
}
