/*
 * The eight accent presets of a report. `color` is the ink on white (text, rules, the cover band)
 * and `tint` the quiet background beside it. The same values are declared per `data-accent` in
 * `styles.css`, which is what the report paints with; keep the two in step.
 */
export const ACCENTS = [
  { id: "violet", label: "Violet", color: [0.5, 0.19, 286], tint: [0.96, 0.025, 286] },
  { id: "blue", label: "Blue", color: [0.5, 0.17, 255], tint: [0.96, 0.025, 255] },
  { id: "teal", label: "Teal", color: [0.5, 0.09, 195], tint: [0.96, 0.025, 195] },
  { id: "green", label: "Green", color: [0.48, 0.12, 155], tint: [0.96, 0.025, 155] },
  { id: "amber", label: "Amber", color: [0.48, 0.1, 65], tint: [0.96, 0.025, 65] },
  { id: "red", label: "Red", color: [0.5, 0.19, 25], tint: [0.96, 0.025, 25] },
  { id: "pink", label: "Pink", color: [0.5, 0.18, 350], tint: [0.96, 0.025, 350] },
  { id: "slate", label: "Slate", color: [0.45, 0.03, 260], tint: [0.96, 0.01, 260] },
] as const

export type AccentId = (typeof ACCENTS)[number]["id"]

export const DEFAULT_ACCENT: AccentId = "violet"

const clamp = (value: number) => Math.min(1, Math.max(0, value))

/** WCAG contrast of white text on the preset (the ratio is the same for the preset on white). */
export function contrastOnWhite(id: AccentId): number {
  const [lightness, chroma, hue] = ACCENTS.find((accent) => accent.id === id)?.color ?? [0, 0, 0]
  const a = chroma * Math.cos((hue * Math.PI) / 180)
  const b = chroma * Math.sin((hue * Math.PI) / 180)
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  const luminance =
    0.2126 * clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s) +
    0.7152 * clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s) +
    0.0722 * clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
  return 1.05 / (luminance + 0.05)
}
