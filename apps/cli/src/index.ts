#!/usr/bin/env node
import { decode } from "@ovriq/zinko-decoders"

const USAGE = `zinko — open-source tracking auditor

Usage:
  zinko decode <hit-url> [--body <raw-body>]   Decode a GA4 or Meta Pixel request
  zinko audit <site-url>                       Crawl and audit a site (coming soon)
`

function main(argv: string[]): number {
  const [command, target, ...rest] = argv
  switch (command) {
    case "decode": {
      if (!target) break
      const bodyFlag = rest.indexOf("--body")
      const body = bodyFlag >= 0 ? rest[bodyFlag + 1] : undefined
      const hits = decode({ url: target, body })
      if (hits.length === 0) {
        console.error("No known tracking hit in that request.")
        return 1
      }
      process.stdout.write(`${JSON.stringify(hits, null, 2)}\n`)
      return 0
    }
    case "audit":
      console.error(
        "`audit` is not implemented yet. Track progress at https://github.com/ovriq/zinko",
      )
      return 2
  }
  process.stdout.write(USAGE)
  return command && command !== "help" && command !== "--help" ? 1 : 0
}

process.exitCode = main(process.argv.slice(2))
