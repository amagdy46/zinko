import { scrubPersonalData } from "@repo/rules"

const CONTROL_CHARACTERS = /\p{Cc}+/gu
// A scheme URL, a `www.` host, or a root-relative path that carries a query or fragment.
const URL_SHAPED =
  /(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s"'<>)\]]+|(?<![\w/])\/[^\s"'<>)\]?#]*[?#][^\s"'<>)\]]*/gi

export const REDACT_MAX_LENGTH = 1000

/**
 * A backstop for text that was not replaced by an alias or a fixed label first (the model's
 * answer, mostly): control characters become spaces, URLs lose their query and fragment, email
 * addresses and international phone numbers are replaced, and the length is capped. It reduces
 * what leaves and what comes back; it does not find names, tokens or domestic phone numbers.
 */
export function redact(text: string): string {
  const withoutControls = text.replace(CONTROL_CHARACTERS, " ")
  const withoutQueries = withoutControls.replace(URL_SHAPED, (url) => url.replace(/[?#].*$/s, ""))
  return scrubPersonalData(withoutQueries).slice(0, REDACT_MAX_LENGTH)
}
