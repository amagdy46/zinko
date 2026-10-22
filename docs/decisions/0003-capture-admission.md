# 0003: Capture admission, a FIFO gate in a Durable Object

Date: 2026-10-22 · Status: accepted

## Context

An engine runs one capture at a time and answers 429 while busy. Locally every audit shares the one engine at `BROWSER_URL`. On Cloudflare each audit had its own container instance (`instance: auditId`), with `maxInstances` 3 and `sleepAfter` 2 minutes.

Nothing decided which audit goes next. Each `capture-<n>` step that met a busy engine (429) or no free container (503) failed and was retried by Cloudflare on the step's own schedule: 15 s, doubling, 8 retries, about 64 minutes in all. The audits polled the engine independently:

- **The engine sat idle.** A freed engine waited until some audit's backoff ran out. The M2 measurement had four 3-run audits finishing after 52 s, 2.4, 4.2 and 8.2 minutes. In the M3 demo, one of five audits had run no capture after 50 minutes.
- **No order.** Whichever retry landed first won. An audit queued first could be starved by one queued later.
- **On Cloudflare it was worse.** A fourth audit needed a fourth instance. It got 503 until a finished audit's container went to sleep (2 minutes idle), then waited out its own backoff on top.

The bar: queued audits start as soon as an engine frees up, in the order they were started, with one engine locally and with several containers in production.

## Decision

- **One gate, a Durable Object.** `AdmissionGate` (`apps/web/src/browser/AdmissionGate.ts`, bound as `ADMISSION_GATE`, one instance named `engines`) keeps two lists in Durable Object storage: which audit holds which engine, and the line of waiting audits in arrival order. Each call reads the state, changes it and writes it back with no other I/O in between, so concurrent calls cannot interleave. App code reaches it through the `CaptureAdmission` service in `@repo/core` (`admit(auditId)`, `release(auditId)`), implemented in `apps/web/src/server/admission.ts`.
- **Engines are named slots, not audits.** `Browser.engines` lists the instance names that can capture at once: `["local"]` for the `BROWSER_URL` engine, `engine-0` to `engine-<n-1>` for the container binding, where n is `BROWSER_ENGINES`. Alchemy sets `BROWSER_ENGINES` and `maxInstances` from one constant (3). An audit captures on the engine it was handed. A container is no longer tied to an audit, so the next audit gets a warm container straight away instead of waiting for the last one to go to sleep.
- **An audit holds its engine from its first capture to its last.** Before each run the workflow asks for an engine (`admit-<n>`). A holder gets its engine back and its lease renewed. Anyone else joins the line, and the head of the line gets each engine that frees up. After the last run, `release` frees the engine, and `finish` follows. So audits run first come, first served: the first finishes as fast as it would alone, and the others wait in order instead of all slowing down together.
- **Waiting is a workflow event, with a timer as a safety net.** While waiting, the workflow sits in `waitForEvent("queued-<n>-<k>", { type: "engine-free", timeout: "1 minute" })` and then asks again (`admit-<n>-<k>`). When a release (or a lapsed lease) hands an engine to a waiter, the call that did it sends that waiter's workflow an `engine-free` event (`Jobs.sendEvent`). The waiter wakes within milliseconds. If the event is lost, it still asks again within a minute.
- **Leases recover from crashes.** A holder that has not asked for 5 minutes loses its engine. A capture attempt times out at 4 minutes and the engine stops a capture at 135 s, so a healthy audit always asks again in time. A waiter handed an engine must claim it within 90 s. A waiter that has not asked for 3 minutes leaves the line, for example when its workflow was deleted.
- **The audit stays `queued` until admitted.** `start` only lists the runs. The first admission marks the audit `running`, sets `started_at` and publishes the status. The UI already treats `queued` as active.
- **Failure handling.** If the gate stays unreachable through the admit step's retries (5, from 2 s), the run records `EngineBusy`, the same as before. A failed `release` is ignored, because the lease lapses on its own. The 429/503 retry policy on `capture-<n>` stays as it was, for the rare collision after a lease lapses.

## Alternatives considered

- **Short, capped, jittered backoff on EngineBusy (for example a constant 5 s).** This is the cheapest fix and only changes the step config. It is not chosen because it fixes promptness but not fairness. The audit that holds the engine asks again within milliseconds of its persist, so it keeps winning, and the waiting audits win the engine at random. Waiting would also cost a step attempt every 5 s per waiting audit, and Cloudflare still could not start a fourth container until one slept.
- **Limit concurrent audits in `startAudit`, with a queued status and a scheduler.** Something then has to start the next audit when one finishes: a cron, or `finish` starting the oldest queued audit. That spreads the queue across Postgres and the workflow, races with retries, and needs its own crash recovery. It is the same gate, built from parts that do not fit it as well as a Durable Object does.
- **Hand out a slot per capture instead of per audit.** This interleaves audits round-robin. It is fairer to a small audit queued behind a large one, but every audit finishes at the speed of the slowest. It also suits Cloudflare badly: per-audit containers made each switch a container change. It can be revisited when engines take several captures at once.
- **A Cloudflare Queue in front of the engines.** Queues deliver at least once and order is best effort, so it would still need a per-engine lock. A queue consumer also cannot wait for hours the way a workflow can.

## Consequences

- One Durable Object is shared by every organization, so the line is global and first come, first served across organizations. A big audit from one organization holds an engine until it finishes. Per-organization limits or weighting can be added in the gate later, because every caller goes through it.
- Audits no longer run in parallel locally: they take turns on the one engine, which is all the engine could do anyway. On Cloudflare, three audits run at once, one per container, and the rest wait in order.
- The workflow has one more step per run (`admit-<n>`), plus two steps per minute of waiting. A 168-run audit, the largest the form allows, uses about 680 steps before any waiting, against a limit of 10,000 steps per instance on Workers Paid (1,024 on Free, which leaves room for only about 2.5 hours in line at that size).
- The containers are shared across audits, one capture at a time. Each capture already launches a fresh browser per scenario behind its own egress proxy, so audits share no browser state.
- Verified locally against one engine (M3, 2026-10-22): five 3-run fixture audits started at once ran in queue order, with 0.1 to 0.2 s between one capture ending and the next starting. See `docs/roadmap.md`. Containers on Cloudflare are still untried.
