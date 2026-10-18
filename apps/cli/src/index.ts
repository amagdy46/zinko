#!/usr/bin/env node
import { decode } from "@ovriq/spoorline-decoders";

const USAGE = `spoorline — open-source tracking auditor

Usage:
  spoorline decode <hit-url> [--body <raw-body>]   Decode a GA4 or Meta Pixel request
  spoorline audit <site-url>                       Crawl and audit a site (coming soon)
`;

function main(argv: string[]): number {
  const [command, target, ...rest] = argv;
  switch (command) {
    case "decode": {
      if (!target) break;
      const bodyFlag = rest.indexOf("--body");
      const body = bodyFlag >= 0 ? rest[bodyFlag + 1] : undefined;
      const hits = decode({ url: target, body });
      if (hits.length === 0) {
        console.error("No known tracking hit in that request.");
        return 1;
      }
      console.log(JSON.stringify(hits, null, 2));
      return 0;
    }
    case "audit":
      console.error("`audit` is not implemented yet. Track progress at https://github.com/ovriq/spoorline");
      return 2;
  }
  console.log(USAGE);
  return command && command !== "help" && command !== "--help" ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
