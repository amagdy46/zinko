import { Container } from "@cloudflare/containers"

/**
 * Runs the image built from `apps/browser/Dockerfile`. Cloudflare starts it on the first request
 * and stops it after `sleepAfter` without traffic. Bound as BROWSER (wrangler.jsonc or infra/alchemy.run.ts) and exported
 * from `src/server.ts`.
 *
 * `pnpm dev` doesn't start containers (`dev.enable_containers` is false in wrangler.jsonc), so it
 * works without Docker and Browser calls fail locally. Set it to true to run the image locally.
 */
export class BrowserContainer extends Container {
  defaultPort = 8080
  sleepAfter = "5m"
}
