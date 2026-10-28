import { defineConfig } from "drizzle-kit"
import { existsSync } from "node:fs"
import { join } from "node:path"

const envFile = join(import.meta.dirname, "../../.env")
if (existsSync(envFile)) process.loadEnvFile(envFile)

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/*schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/app",
  },
})
