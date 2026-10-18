import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"
import { runtime } from "./runtime"

export const getGreeting = createServerFn({ method: "GET" }).handler(() =>
  runtime.runPromise(
    Effect.gen(function* () {
      yield* Effect.log("greeting requested")
      return "Hello from Effect"
    }),
  ),
)
