import { Storage } from "@repo/core"
import { Database } from "@repo/core/Database"
import { sniffImageType } from "@repo/core/image-type"
import { orgBranding } from "@repo/db"
import { createServerFn } from "@tanstack/react-start"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { brandingOf, sha256Hex } from "./branding-data"
import { requireSession } from "./require-session"
import { Forbidden, Invalid, isManager, membership, mutation } from "./server-fn"

const LOGO_MAX_BYTES = 512 * 1024

const deleteQuietly = (key: string | null) =>
  key === null
    ? Effect.void
    : Effect.gen(function* () {
        const storage = yield* Storage
        yield* storage.delete(key)
      }).pipe(
        Effect.catch((error) => Effect.logWarning("logo object not deleted", error.operation)),
      )

const manager = (session: Parameters<typeof membership>[0]) =>
  Effect.gen(function* () {
    const found = yield* membership(session)
    if (!isManager(found.role))
      return yield* new Forbidden({
        message: "Only organization owners and admins can change the logo.",
      })
    return found
  })

/**
 * Stores a new logo under a key that never existed, points the branding row at it, then deletes the
 * previous object. The client's content type and file name are ignored: the bytes decide the type.
 */
export const uploadLogo = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator((data: unknown) => {
    if (!(data instanceof FormData)) throw new Error("Expected a form")
    return data
  })
  .handler(({ context, data }) =>
    mutation(
      Effect.gen(function* () {
        const { organizationId, userId } = yield* manager(context.session)
        const file = data.get("file")
        if (!(file instanceof File)) return yield* new Invalid({ message: "Choose an image file." })
        if (file.size === 0) return yield* new Invalid({ message: "The file is empty." })
        if (file.size > LOGO_MAX_BYTES)
          return yield* new Invalid({ message: "The logo must be 512 KB or smaller." })
        const bytes = new Uint8Array(yield* Effect.promise(() => file.arrayBuffer()))
        const type = sniffImageType(bytes)
        if (type === undefined)
          return yield* new Invalid({ message: "The logo must be a PNG, JPEG or WebP image." })
        const digest = yield* sha256Hex(bytes)
        const storage = yield* Storage
        const key = `branding/${organizationId}/${crypto.randomUUID()}`
        yield* storage.put(key, bytes, { contentType: type }).pipe(Effect.orDie)
        const current = yield* brandingOf(organizationId)
        const { db } = yield* Database
        const logo = { logoKey: key, logoType: type, logoSha256: digest }
        const values = { ...logo, updatedBy: userId, updatedAt: new Date() }
        yield* db
          .insert(orgBranding)
          .values({ ...current, ...values, orgId: organizationId })
          .onConflictDoUpdate({ target: orgBranding.orgId, set: values })
          .pipe(Effect.tapError(() => deleteQuietly(key)))
        yield* deleteQuietly(current.logoKey)
        return { logoType: type, logoSha256: digest }
      }),
    ),
  )

/** Deletes the logo object and clears the three columns. */
export const removeLogo = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .handler(({ context }) =>
    mutation(
      Effect.gen(function* () {
        const { organizationId, userId } = yield* manager(context.session)
        const current = yield* brandingOf(organizationId)
        const { db } = yield* Database
        yield* db
          .update(orgBranding)
          .set({
            logoKey: null,
            logoType: null,
            logoSha256: null,
            updatedBy: userId,
            updatedAt: new Date(),
          })
          .where(eq(orgBranding.orgId, organizationId))
        yield* deleteQuietly(current.logoKey)
        return null
      }),
    ),
  )
