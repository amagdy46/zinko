import { Container } from "@cloudflare/containers"

/**
 * Runs the image built from `apps/browser/Dockerfile`. Cloudflare starts it on the first request
 * and stops it after `sleepAfter` without traffic. Bound as BROWSER (wrangler.jsonc or infra/alchemy.run.ts) and exported
 * from `src/server.ts`.
 *
 * Instances are per audit, so a short `sleepAfter` releases them for the next one. `pnpm dev`
 * doesn't run this class: with `BROWSER_URL` set, infra/alchemy.run.ts skips the container and
 * the Worker talks to an engine started by hand (see CONTRIBUTING.md).
 */
export class BrowserContainer extends Container {
  defaultPort = 8080
  sleepAfter = "2m"
}
