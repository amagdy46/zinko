import { DurableObject } from "cloudflare:workers"

const PORT = 8080
const IDLE_MS = 2 * 60 * 1000
const READY_TIMEOUT_MS = 60 * 1000
// Prefixed so `interpret` in server/browser.ts reports a failed start as 503 (try again later).
const START_FAILURE = "Failed to start container"

/**
 * One capture engine: the image built from `apps/browser/Dockerfile`, started by this Durable Object.
 * This account uses the `durable_object` scheduling policy, so the image and instance size are
 * chosen here in `start()`, not on the application, and there is no `maxInstances`: the
 * AdmissionGate caps concurrency by handing out the instance names `engine-0` to `engine-<n - 1>`
 * (`BROWSER_ENGINES`). The container stops after `IDLE_MS` without a request. Bound as BROWSER
 * (infra/alchemy.run.ts) and exported from `src/server.ts`.
 *
 * `pnpm dev` doesn't run this class: with `BROWSER_URL` set, infra/alchemy.run.ts skips the
 * container and the Worker talks to an engine started by hand (see CONTRIBUTING.md).
 */
export class BrowserContainer extends DurableObject {
  private active = 0

  override async fetch(request: Request): Promise<Response> {
    const container = this.ctx.container
    if (container === undefined)
      return new Response(`${START_FAILURE}: no container`, { status: 500 })
    this.active += 1
    try {
      if (!container.running) {
        container.start({
          // the key is the Container's id in infra/alchemy.run.ts
          image: container.images.Browser,
          // a capture needs up to ~1 GiB; `lite`, the default, is too small
          instance: "standard-1",
          // the engine's own egress proxy enforces the URL policy
          enableInternet: true,
        })
      }
      const port = container.getTcpPort(PORT)
      const failure = await this.untilReady(port)
      if (failure !== undefined)
        return new Response(`${START_FAILURE}: ${failure}`, { status: 500 })
      return await port.fetch(request)
    } finally {
      this.active -= 1
      await this.ctx.storage.setAlarm(Date.now() + IDLE_MS)
    }
  }

  override async alarm(): Promise<void> {
    if (this.active > 0) {
      await this.ctx.storage.setAlarm(Date.now() + IDLE_MS)
      return
    }
    await this.ctx.container?.destroy()
  }

  // start() returns before the engine listens, so poll its /health until it answers
  private async untilReady(
    port: Fetcher,
    deadline = Date.now() + READY_TIMEOUT_MS,
  ): Promise<string | undefined> {
    const answered = await port.fetch("http://container/health").then(
      (response) => response.ok,
      () => false,
    )
    if (answered) return undefined
    if (Date.now() >= deadline) return "the engine did not answer /health in time"
    await new Promise((resolve) => setTimeout(resolve, 500))
    return this.untilReady(port, deadline)
  }
}
