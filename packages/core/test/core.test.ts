import { expect, it } from "@effect/vitest"
import { Effect } from "effect"

it.effect("runs Effect tests", () => Effect.succeed(1).pipe(Effect.map((n) => expect(n).toBe(1))))
