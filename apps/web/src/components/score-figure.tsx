import { StatusGlyph, type StatusMeaning } from "@/components/status-glyph"
import {
  BAND_LABEL,
  scoreCoverage,
  tooLittleCaptured,
  type Band,
  type ScoreCoverage,
} from "@/lib/health-score"
import { cn } from "@/lib/utils"

const BAND_GLYPH: Record<Band, StatusMeaning> = {
  critical: "critical",
  attention: "warning",
  minor: "info",
  "no-failures": "pass",
}

const NOT_ENOUGH = "Not enough was captured to score"

const BAND_BAR: Record<Band, string> = {
  critical: "fill-sev-critical-solid",
  attention: "fill-sev-warning-solid",
  minor: "fill-sev-info-solid",
  "no-failures": "fill-status-pass-solid",
}

/** The glyph for a band, downgraded when the number does not cover everything (see `scoreCoverage`). */
function bandGlyph(band: Band | undefined, state: "full" | "checks" | "runs"): StatusMeaning {
  if (state === "runs" || band === undefined) return "partial"
  if (band === "no-failures" && state !== "full") return "could-not-check"
  return BAND_GLYPH[band]
}

/**
 * A health score and how much of it was checked. Below full coverage (see `scoreCoverage`) the
 * number is muted, "Not fully checked" and the exact counts follow it, and the band never reads as
 * a pass. When half the runs or fewer were captured (evaluated and finished) the number is replaced by "—" and
 * "Not enough was captured to score". Pure props in, markup out, so the report can reuse it.
 * `hero` is the large figure with its band; `cell` fits a table cell; `inline` is one line.
 */
export function ScoreFigure({
  score,
  coverage,
  band,
  bandAllAccepted = false,
  size = "cell",
  className,
}: {
  score: number
  coverage: ScoreCoverage
  /** Shown by `hero` only. */
  band?: Band
  /** Every finding behind the band is an accepted risk: the headline still counts them, so say so. */
  bandAllAccepted?: boolean
  size?: "hero" | "cell" | "inline"
  className?: string
}) {
  const { state, notes } = scoreCoverage(coverage)
  const full = state !== "runs"
  const number = cn("tabular-nums", !full && "text-muted-foreground")
  const sparse = tooLittleCaptured(coverage)
  if (sparse && size === "inline")
    return (
      <span className={cn("inline-flex items-center gap-1 text-muted-foreground", className)}>
        —<span className="sr-only">{NOT_ENOUGH}</span>
      </span>
    )
  if (sparse && size === "cell")
    return (
      <div className={cn("space-y-0.5", className)}>
        <p className="text-sm font-medium text-muted-foreground">—</p>
        <p className="text-xs">{NOT_ENOUGH}</p>
        <p className="text-xs text-muted-foreground">{notes.join(" · ")}</p>
      </div>
    )
  if (sparse)
    return (
      <div className={cn("min-w-0 space-y-1", className)}>
        <p
          className="text-5xl font-semibold tracking-tight text-muted-foreground"
          data-testid="score"
        >
          —
        </p>
        <p className="flex items-center gap-2 text-sm font-medium" data-testid="band">
          <StatusGlyph meaning="partial" />
          {NOT_ENOUGH}
        </p>
        <p className="text-xs text-muted-foreground">{notes.join(" · ")}</p>
      </div>
    )
  if (size === "inline")
    return (
      <span className={cn("inline-flex items-center gap-1 tabular-nums", className)}>
        <span className={cn(!full && "text-muted-foreground")}>{score}/100</span>
        {full ? null : (
          <>
            <StatusGlyph meaning="partial" className="size-3.5" />
            <span className="sr-only">Not fully checked: {notes.join(", ")}</span>
          </>
        )}
      </span>
    )
  if (size === "cell")
    return (
      <div className={cn("space-y-0.5", className)}>
        <p className="text-sm font-medium">
          <span className={number}>{score}</span>
          <span className="font-normal text-muted-foreground">/100</span>
        </p>
        {full ? null : (
          <p className="flex items-center gap-1.5 text-xs">
            <StatusGlyph meaning="partial" className="size-3.5" />
            Not fully checked
          </p>
        )}
        {notes.length === 0 ? null : (
          <p className="text-xs text-muted-foreground">{notes.join(" · ")}</p>
        )}
      </div>
    )
  const caveated = band === "no-failures" && state !== "full"
  let bandWord =
    band === undefined || caveated ? "No failures in what was checked" : BAND_LABEL[band]
  if (bandAllAccepted && band !== "no-failures") bandWord += " (accepted)"
  const glyph = bandGlyph(band, state)
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <p className="flex items-baseline gap-1.5" data-testid="score">
        <span className={cn("text-5xl font-semibold tracking-tight", number)}>{score}</span>
        <span className="text-sm text-muted-foreground">/ 100</span>
      </p>
      {band === undefined ? null : (
        <p
          className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-medium"
          data-testid="band"
        >
          <StatusGlyph meaning={glyph} />
          {state === "runs" ? (
            <>
              Not fully checked
              <span className="font-normal text-muted-foreground">· {bandWord}</span>
            </>
          ) : (
            bandWord
          )}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {state === "full" ? "All runs evaluated, every check resolved" : notes.join(" · ")}
      </p>
    </div>
  )
}

/**
 * The score as one small, fixed-width figure for lists: a band glyph, the number, a 3px bar that is
 * the score on a 0 to 100 track in the band's colour, and, when the number does not cover everything,
 * the same qualifier `ScoreFigure` uses. Not scorable (no score, or too little captured) is an honest
 * "—", never a zero. Pure props in, markup out. Reads the band and coverage logic of `health-score`; it adds no thresholds.
 */
export function ScoreChip({
  score,
  band,
  coverage,
  className,
}: {
  score: number | null
  band: Band | null
  coverage: ScoreCoverage
  className?: string
}) {
  const { state, notes } = scoreCoverage(coverage)
  if (score === null || tooLittleCaptured(coverage))
    return (
      <div
        className={cn("w-24 space-y-1", className)}
        title={score === null ? "Not scored" : NOT_ENOUGH}
      >
        <p className="text-base leading-6 font-semibold text-muted-foreground">
          —<span className="sr-only">{score === null ? "Not scored" : NOT_ENOUGH}</span>
        </p>
        <svg
          aria-hidden="true"
          viewBox="0 0 100 3"
          preserveAspectRatio="none"
          className="h-[3px] w-full"
        >
          <rect width="100" height="3" className="fill-muted" />
        </svg>
      </div>
    )
  let bandWord: string | null = null
  if (band !== null)
    bandWord =
      band === "no-failures" && state !== "full"
        ? "No failures in what was checked"
        : BAND_LABEL[band]
  return (
    <div
      className={cn("w-24 space-y-1", state !== "full" && "w-auto min-w-24 max-w-44", className)}
      title={notes.join(" · ") || undefined}
    >
      <p className="flex items-center gap-1.5 text-base leading-6 font-semibold tabular-nums">
        <StatusGlyph meaning={bandGlyph(band ?? undefined, state)} className="size-3.5" />
        <span className={cn(state === "runs" && "text-muted-foreground")}>{score}</span>
        <span className="text-2xs font-normal text-muted-foreground">/100</span>
        {bandWord === null ? null : <span className="sr-only">{bandWord}</span>}
      </p>
      <svg
        aria-hidden="true"
        viewBox="0 0 100 3"
        preserveAspectRatio="none"
        className="h-[3px] w-full"
      >
        <rect width="100" height="3" className="fill-muted" />
        <rect
          width={score}
          height="3"
          className={band === null ? "fill-muted-foreground" : BAND_BAR[band]}
        />
      </svg>
      {state === "full" ? null : (
        <p className="text-2xs leading-4 text-muted-foreground">
          {bandWord === null ? null : (
            <span className="font-medium text-foreground">{bandWord}</span>
          )}
          {bandWord === null ? null : <br />}
          {notes.join(" · ")}
        </p>
      )}
    </div>
  )
}

export interface SparkPoint {
  score: number
  /** Whether that audit's score had full coverage; otherwise the dot is hollow. */
  full: boolean
}

const WIDTH = 72
const HEIGHT = 24
const PAD = 4

/** The last few scores, oldest first, on a fixed 0 to 100 scale. Needs two points to say anything. */
export function ScoreSparkline({ points }: { points: ReadonlyArray<SparkPoint> }) {
  if (points.length < 2)
    return (
      <span className="text-xs text-muted-foreground">
        {points.length === 0 ? "No audits yet" : "One audit"}
      </span>
    )
  const at = points.map((p, i) => ({
    ...p,
    x: PAD + (i * (WIDTH - 2 * PAD)) / (points.length - 1),
    y: PAD + ((100 - p.score) * (HEIGHT - 2 * PAD)) / 100,
  }))
  return (
    <svg
      role="img"
      aria-label={`Last ${points.length} scores, oldest first: ${points.map((p) => p.score).join(", ")}`}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-6 w-[72px] shrink-0"
    >
      <polyline
        points={at.map((p) => `${p.x},${p.y}`).join(" ")}
        className="fill-none stroke-muted-foreground"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {at.map((p) => (
        <circle
          key={p.x}
          cx={p.x}
          cy={p.y}
          r="2.5"
          strokeWidth="1.5"
          className={
            p.full ? "fill-foreground stroke-foreground" : "fill-card stroke-muted-foreground"
          }
        />
      ))}
    </svg>
  )
}
