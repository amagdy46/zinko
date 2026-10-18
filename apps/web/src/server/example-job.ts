import { Jobs } from '@repo/core'
import { createServerFn } from '@tanstack/react-start'
import { Effect, Schema } from 'effect'
import { requireSession } from './require-session'
import { runtime } from './runtime'

const StartInput = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
})
const StatusInput = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
})

/** Starts the example workflow; returns its instance id. */
export const startExampleJob = createServerFn({ method: 'POST' })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(StartInput))
  .handler(({ data }) =>
    runtime.runPromise(
      Effect.gen(function* () {
        const jobs = yield* Jobs
        return yield* jobs.start('example', { name: data.name })
      }),
    ),
  )

export const getExampleJobStatus = createServerFn({ method: 'GET' })
  .middleware([requireSession])
  .validator(Schema.toStandardSchemaV1(StatusInput))
  .handler(({ data }) =>
    runtime.runPromise(
      Effect.gen(function* () {
        const jobs = yield* Jobs
        const { status, output, error } = yield* jobs.status('example', data.id)
        // server function results must be serializable, so the output travels as JSON text
        return { status, error, outputJson: JSON.stringify(output ?? null) }
      }),
    ),
  )
