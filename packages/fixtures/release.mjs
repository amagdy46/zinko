const [site, to] = process.argv.slice(2)
if (!site || to === undefined) {
  console.error("usage: pnpm --filter @repo/fixtures release <site> <release>")
  process.exit(1)
}
const base = `http://localhost:${process.env.FIXTURES_PORT ?? 4400}`
const response = await fetch(`${base}/_release/${site}?to=${to}`, { method: "POST" })
process.stdout.write(`${await response.text()}\n`)
process.exit(response.ok ? 0 : 1)
