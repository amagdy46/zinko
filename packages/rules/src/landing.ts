import type { Vendor } from "@ovriq/zinko-decoders"
import type { CapturedDocument } from "@repo/capture-contract"
import type { RunInput } from "./types.js"

/** The ad click IDs a landing URL can carry, with the vendor and the cookie that keeps each. */
export const CLICK_IDS: readonly { param: string; vendor: Vendor; cookie: string }[] = [
  { param: "gclid", vendor: "google-ads", cookie: "_gcl_aw" },
  { param: "fbclid", vendor: "meta", cookie: "_fbc" },
  { param: "ttclid", vendor: "tiktok", cookie: "_ttp" },
]

/** The value of a query parameter, or `null` when the URL lacks it or does not parse. */
export function queryParam(url: string, name: string): string | null {
  if (!URL.canParse(url)) return null
  const value = new URL(url).searchParams.get(name)
  return value === "" ? null : value
}

/** The run's first document: where the start URL landed, after its redirects. */
export function landingDocument(input: RunInput): CapturedDocument | undefined {
  return input.capture.documents[0]
}
