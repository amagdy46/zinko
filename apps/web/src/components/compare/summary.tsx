import { ChangeGlyph } from "@/components/change-badge"
import type { ChangeState, Comparison } from "@/lib/compare"
import { CHANGE_ORDER, CHANGE_WORDS } from "@/lib/compare-text"
import { cn } from "@/lib/utils"

const deltaWord = (delta: number) => {
  if (delta === 0) return "no change"
  return delta > 0 ? `+${delta}` : `\u2212${Math.abs(delta)}`
}

/** The six counts as filter buttons, and the score line under them. */
export function CompareSummary({
  comparison,
  selected,
  onSelect,
}: {
  comparison: Comparison
  selected: ChangeState | undefined
  onSelect: (state: ChangeState | undefined) => void
}) {
  const { score, counts } = comparison
  let scoreText = "Neither audit has a score."
  if (score.before !== null && score.now !== null) {
    scoreText =
      score.delta === null
        ? `Score ${score.before} before, ${score.now} now. No change is shown: ${score.deltaWhyNot?.replace(/\.$/, "").toLowerCase()}.`
        : `Score ${score.before} to ${score.now} (${deltaWord(score.delta)}).`
  }
  return (
    <div className="space-y-3">
      <ul
        className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"
        aria-label="Changes by state"
      >
        {CHANGE_ORDER.map((state) => (
          <li key={state}>
            <button
              type="button"
              aria-pressed={selected === state}
              disabled={counts[state] === 0}
              onClick={() => onSelect(selected === state ? undefined : state)}
              className={cn(
                "flex h-full min-h-12 w-full items-center gap-2 rounded-md border bg-card px-3 py-2 text-left text-sm outline-none hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-default disabled:text-muted-foreground disabled:hover:bg-card",
                selected === state && "border-primary bg-accent",
              )}
            >
              <ChangeGlyph state={state} />
              <span className="text-lg font-semibold tabular-nums">{counts[state]}</span>
              <span className="min-w-0">{CHANGE_WORDS[state]}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted-foreground">
        {scoreText} Both scores use score version {score.scoreVersion}, today's arithmetic.
      </p>
    </div>
  )
}
