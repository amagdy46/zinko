import type { ReactNode } from "react"
import { ChangeGlyph } from "@/components/change-badge"
import { CHANGE_WORDS } from "@/lib/compare-text"
import { count } from "@/lib/format"
import { reportDate, type ReportModel } from "@/lib/report-model"

type Changes = NonNullable<ReportModel["changes"]>
type Item = Changes["items"][number]
type Tag = Changes["tags"][number]

const NOTICE_WORDS: Record<Changes["notices"][number], string> = {
  rules_changed:
    "Some checks changed between the two rules versions and are not compared; they are not listed above.",
  scope_differs: "The two audits did not check exactly the same pages, scenarios and viewports.",
  banner_differs: "The cookie banner was found in one audit and not in the other on some pages.",
  consent_differs: "A consent choice was applied in one audit and not in the other on some pages.",
  score_not_comparable: "The scores are shown, but not compared: the audits are not alike enough.",
}

const TAG_WORDS: Record<Tag["change"], string> = {
  disappeared: "Disappeared",
  destination_changed: "Destination changed",
  events_changed: "Events changed",
  new: "New",
}

/** An uncertain change says so in the report too: it is frozen with the item. */
const qualification = (item: Item) => {
  const parts: string[] = []
  if (item.confirmation === "not_repeated") parts.push("did not repeat on re-check")
  else if (item.confirmation === "incomplete") parts.push("re-check incomplete")
  else if (item.confidence === "low" && item.confirmation !== "repeated")
    parts.push("may be a flaky result")
  if (item.qualifier === "partly_unknown_before")
    parts.push("it could not be checked on some pages before")
  return parts.length === 0 ? null : parts.join("; ")
}

/** Where it changed: on the pages both audits checked, and separately on pages only one of them had. */
const pagesLine = (item: Item) => {
  const compared = `On ${item.pages} of ${count(item.pagesCompared, "compared page")}`
  if (item.pagesOutside === 0) return compared
  return `${compared}, and on ${count(item.pagesOutside, "other page")} that the earlier audit did not check`
}

const tagLine = (tag: Tag) => {
  const name = `${tag.vendor}${tag.destination === null ? "" : ` ${tag.destination}`}`
  const where = `${tag.cellsAffected} of ${count(tag.cellsCompared, "run")}`
  if (tag.change === "disappeared") return `${name} no longer fires (${where}).`
  if (tag.change === "new") return `${name} now fires (${where}).`
  if (tag.change === "destination_changed")
    return `${tag.vendor} sends to another destination (${where}).`
  const parts = [
    tag.eventsRemoved.length > 0 && `${tag.eventsRemoved.join(", ")} no longer sent`,
    tag.eventsAdded.length > 0 && `${tag.eventsAdded.join(", ")} now sent`,
  ]
  return `${name}: ${parts.filter((p) => p !== false).join("; ")} (${where}).`
}

/** "What changed since <date>": after the summary, before the scope. Null changes print nothing. */
export function Changes({ model, extra }: { model: ReportModel; extra?: ReactNode }) {
  const { changes } = model
  if (changes === null && extra === undefined) return null
  if (changes === null) return <div className="px-4 sm:px-8 pt-6 text-sm print:hidden">{extra}</div>
  return (
    <section
      id="changes"
      aria-label="What changed"
      className="space-y-4 px-4 sm:px-8 py-8 text-sm leading-6 print:p-0 print:pt-8 print:leading-snug"
    >
      {changes === null ? null : (
        <>
          <h2 className="text-xl font-semibold">
            What changed since {reportDate(changes.baselineDate)}
          </h2>
          <ul className="list-disc space-y-1 pl-5">
            {changes.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {changes.items.length === 0 ? null : (
            <ul className="divide-y rounded-md border" aria-label="Changed findings">
              {changes.items.map((item) => {
                const note = qualification(item)
                return (
                  <li key={item.ruleId} className="space-y-0.5 px-3 py-2">
                    <p className="flex flex-wrap items-center gap-x-2">
                      <span className="inline-flex items-center gap-1.5 font-medium">
                        <ChangeGlyph state={item.state} className="size-3.5" />
                        {CHANGE_WORDS[item.state]}
                      </span>
                      <span className="text-muted-foreground capitalize">{item.severity}</span>
                      <span className="font-medium">{item.title}</span>
                    </p>
                    <p className="text-muted-foreground">
                      {pagesLine(item)}
                      {note === null ? "." : `; ${note}.`}
                    </p>
                  </li>
                )
              })}
            </ul>
          )}
          {changes.omitted > 0 ? (
            <p className="text-muted-foreground">
              {count(changes.omitted, "changed finding")} left out of this report's detail{" "}
              {changes.omitted === 1 ? "is" : "are"} not listed here.
            </p>
          ) : null}
          {changes.tags.length === 0 ? null : (
            <div className="space-y-1">
              <h3 className="font-semibold">Tags</h3>
              <ul className="space-y-0.5">
                {changes.tags.map((tag) => (
                  <li key={`${tag.change}|${tag.vendor}|${tag.destination}|${tagLine(tag)}`}>
                    <span className="font-medium">{TAG_WORDS[tag.change]}:</span> {tagLine(tag)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {changes.notices.length === 0 ? null : (
            <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
              {changes.notices.map((notice) => (
                <li key={notice}>{NOTICE_WORDS[notice]}</li>
              ))}
            </ul>
          )}
        </>
      )}
      {extra}
    </section>
  )
}
