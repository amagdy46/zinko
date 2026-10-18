import { cloudflare } from "@cloudflare/vite-plugin"
import tailwindcss from "@tailwindcss/vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// `alchemy dev` / `alchemy deploy` inject their own resource-aware Cloudflare plugin (with every
// binding from infra/alchemy.run.ts) and set this variable. A plain `vite build` (pnpm build,
// CI) has no bindings to resolve, so it uses a minimal inline config instead of a wrangler.jsonc.
const injectedByAlchemy = process.env.ALCHEMY_CLOUDFLARE_VITE_INJECTED === "1"

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    injectedByAlchemy
      ? null
      : cloudflare({
          config: {
            name: "app",
            main: "src/server.ts",
            compatibility_date: "2026-10-01",
            compatibility_flags: ["nodejs_compat"],
          },
          viteEnvironment: { name: "ssr" },
        }),
    tanstackStart(),
    tailwindcss(),
    viteReact(),
  ],
})
