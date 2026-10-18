import { Database } from "@repo/core/Database"
import { note } from "@repo/db"
import { createServerFn } from "@tanstack/react-start"
import { desc } from "drizzle-orm"
import { Effect } from "effect"
import { runtime } from "./runtime"

export const listNotes = createServerFn({ method: "GET" }).handler(() =>
  runtime.runPromise(
    Effect.gen(function* () {
      const { db } = yield* Database
      return yield* db.select().from(note).orderBy(desc(note.createdAt))
    }),
  ),
)
