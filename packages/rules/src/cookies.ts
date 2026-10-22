import type { Cookie, CookieSnapshot } from "@repo/capture-contract"
import type { EvidenceRef, RunInput } from "./types.js"

const AD_OR_ANALYTICS = /^(_ga|_ga_.+|_gid|_gcl_.+|_fbp|_fbc|_ttp|_tt_.+|ttcsid.*|IDE|test_cookie)$/

/** Google Analytics, Google Ads, Meta and TikTok cookies; consent banners' own cookies are not. */
export function isAdOrAnalyticsCookie(name: string): boolean {
  return AD_OR_ANALYTICS.test(name)
}

export function snapshotsLabelled(
  input: RunInput,
  ...labels: readonly CookieSnapshot["label"][]
): readonly CookieSnapshot[] {
  return input.capture.cookies.filter((snapshot) => labels.includes(snapshot.label))
}

export function cookieRef(snapshot: CookieSnapshot, cookie: Cookie): EvidenceRef {
  return {
    kind: "cookie",
    label: snapshot.label,
    documentId: snapshot.documentId,
    name: cookie.name,
    domain: cookie.domain,
    path: cookie.path,
  }
}
