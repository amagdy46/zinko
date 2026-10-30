import { Fragment } from "react"

// Rule wording is plain text, so code is recognised by shape: a call with arguments, a snake_case or
// leading-underscore name (a parameter or cookie), a camelCase name, a script file, a browser global's
// property, and the few lowercase names rule wording uses bare (generic words like `value` stay prose).
const CODE =
  /[A-Za-z_][\w.]*\((?:[^()]|\([^()]*\))*\)|(?<![\w])_?[a-z0-9]+(?:_[a-z0-9*]+)+|(?<![\w])_[a-z]+\b|\b(?:[a-z]+\.)*[a-z]+[A-Z]\w*\b|\b[\w-]+\.js\b|\b(?:location|window|document|navigator)\.[a-z]\w*\b|\b(?:gtag|gclid|gbraid|wbraid|fbclid|ttclid|msclkid|dclid)\b/g

const isCall = (text: string) => /^[A-Za-z_][\w.]*\(/.test(text)
const callIsCode = (text: string) => /[{'"…]|\(\)$/.test(text)

/** Text with its code set in monospace, for rule wording that has no markup. */
export function CodeText({ text }: { text: string }) {
  const parts: Array<{ code: boolean; value: string; at: number }> = []
  let last = 0
  for (const match of text.matchAll(CODE)) {
    if (isCall(match[0]) && !callIsCode(match[0])) continue
    if (match.index > last)
      parts.push({ code: false, value: text.slice(last, match.index), at: last })
    parts.push({ code: true, value: match[0], at: match.index })
    last = match.index + match[0].length
  }
  parts.push({ code: false, value: text.slice(last), at: last })
  return parts.map((part) => (
    <Fragment key={part.at}>
      {part.code ? <code className="font-mono text-[0.92em]">{part.value}</code> : part.value}
    </Fragment>
  ))
}
