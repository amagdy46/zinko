import { Context, Data, type Effect } from "effect"

export class JobError extends Data.TaggedError("JobError")<{
  readonly operation: string
  readonly cause: unknown
}> {}

/** Payload per job name. Add an entry here when you add a workflow. */
export interface JobPayloads {
  readonly example: { readonly name: string }
}

export type JobName = keyof JobPayloads

export interface JobRun {
  readonly id: string
}

export interface JobStatus {
  readonly status:
    | "queued"
    | "rollingBack"
    | "running"
    | "paused"
    | "errored"
    | "terminated"
    | "complete"
    | "waiting"
    | "waitingForPause"
    | "unknown"
  readonly output: unknown
  readonly error: string | undefined
}

/** Durable background jobs. The Cloudflare layer starts Cloudflare Workflows. */
export class Jobs extends Context.Service<
  Jobs,
  {
    readonly start: <N extends JobName>(
      job: N,
      payload: JobPayloads[N],
    ) => Effect.Effect<JobRun, JobError>
    readonly status: (job: JobName, id: string) => Effect.Effect<JobStatus, JobError>
  }
>()("@repo/core/Jobs") {}
