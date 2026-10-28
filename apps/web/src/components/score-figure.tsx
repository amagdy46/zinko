import { StatusGlyph, type StatusMeaning } from "@/components/status-glyph"
import { BAND_LABEL, scoreCoverage, type Band, type ScoreCoverage } from "@/lib/health-score"
import { cn } from "@/lib/utils"

const BAND_GLYPH: Record<Band, StatusMeaning> = {
  critical: "critical",
  attention: "warning",
  minor: "info",
  "no-failures": "pass",
}

/**
 * A health score and how much of it was checked. Below full coverage (see `scoreCoverage`) the
 * number is muted, "Not fully checked" and the exact counts follow it, and the band never reads as
 * a pass. Pure props in, markup out, so the report can reuse it.
 * `hero` is the large figure with its band; `cell` fits a table cell; `inline` is one line.
 */
export function ScoreFigure({
  score,
  coverage,
  band,
  size = "cell",
  className,
}: {
  score: number
  coverage: ScoreCoverage
  /** Shown by `hero` only. */
  band?: Band
  size?: "hero" | "cell" | "inline"
  className?: string
}) {
  const { full, notes } = scoreCoverage(coverage)
  const number = cn("tabular-nums", !full && "text-muted-foreground")
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
          <>
            <p className="flex items-center gap-1.5 text-xs">
              <StatusGlyph meaning="partial" className="size-3.5" />
              Not fully checked
            </p>
            <p className="text-xs text-muted-foreground">{notes.join(" · ")}</p>
          </>
        )}
      </div>
    )
  const noFailures = band === "no-failures"
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
          <StatusGlyph meaning={full ? BAND_GLYPH[band] : "partial"} />
          {full ? (
            BAND_LABEL[band]
          ) : (
            <>
              Not fully checked
              <span className="font-normal text-muted-foreground">
                · {noFailures ? "No failures in what was checked" : BAND_LABEL[band]}
              </span>
            </>
          )}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {full ? "All runs evaluated, every check resolved" : notes.join(" · ")}
      </p>
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
  if (points.length < 2) return <span className="text-xs text-muted-foreground">One audit</span>
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
