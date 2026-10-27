import { Option, Schema } from "effect"
import { redact } from "./redact.js"

export const FIX_LOCATIONS = [
  "tag manager",
  "consent banner",
  "site code",
  "server",
  "other",
] as const

const MAX_SUMMARY = 400
const MAX_TEXT = 300

const Summary = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_SUMMARY))
const Text = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_TEXT))

/** The model's answer: bounded text only, no field a page could add. */
export const Explanation = Schema.Struct({
  summary: Summary,
  whatWeSaw: Schema.Array(Text).check(Schema.isMaxLength(4)),
  likelyCauses: Schema.Array(Text).check(Schema.isMaxLength(3)),
  fixSteps: Schema.Array(
    Schema.Struct({ step: Text, where: Schema.Literals(FIX_LOCATIONS) }),
  ).check(Schema.isMaxLength(6)),
  verify: Text,
})
export type Explanation = typeof Explanation.Type

const decodeExplanation = Schema.decodeUnknownOption(Schema.fromJsonString(Explanation), {
  onExcessProperty: "error",
})

const FENCE = /^\s*```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n?```\s*$/

function strings(explanation: Explanation): string[] {
  return [
    explanation.summary,
    ...explanation.whatWeSaw,
    ...explanation.likelyCauses,
    ...explanation.fixSteps.map((fix) => fix.step),
    explanation.verify,
  ]
}

/**
 * The model's answer, or `null`. One policy: reject, never repair. The text must be one JSON
 * object (at most one Markdown fence around it) of exactly the `Explanation` shape, every string
 * within its bound, and no string may change under `redact` (an email, an international phone
 * number, a URL with a query, a control character). Render the result as plain text.
 */
export function parseExplanation(text: string): Explanation | null {
  const json = FENCE.exec(text)?.[1] ?? text
  const result = decodeExplanation(json)
  if (Option.isNone(result)) return null
  const explanation = result.value
  return strings(explanation).every((value) => redact(value) === value) ? explanation : null
}
