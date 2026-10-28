import {
  ArrowLeftRight,
  CircleArrowDown,
  CircleCheck,
  CircleEqual,
  CirclePlus,
  CircleSlash,
  type LucideIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import type { ChangeState } from "@/lib/compare"
import { CHANGE_WORDS } from "@/lib/compare-text"
import { cn } from "@/lib/utils"

const neutral = "border-status-neutral-border bg-status-neutral-bg text-status-neutral"

/** A glyph of its own shape and a word per state, so a grayscale screenshot tells all six apart. */
const changes: Record<ChangeState, { icon: LucideIcon; tone: string }> = {
  new: { icon: CirclePlus, tone: neutral },
  regressed: { icon: CircleArrowDown, tone: cn(neutral, "font-semibold") },
  fixed: {
    icon: CircleCheck,
    tone: "border-status-pass-border bg-status-pass-bg text-status-pass",
  },
  unchanged: { icon: CircleEqual, tone: neutral },
  verdict_changed: { icon: ArrowLeftRight, tone: neutral },
  not_comparable: { icon: CircleSlash, tone: cn(neutral, "border-dashed") },
}

export function ChangeGlyph({ state, className }: { state: ChangeState; className?: string }) {
  const { icon: Icon } = changes[state]
  return <Icon aria-hidden="true" className={cn("size-4 shrink-0", className)} />
}

export function ChangeBadge({ state, className }: { state: ChangeState; className?: string }) {
  return (
    <Badge variant="secondary" className={cn("gap-1.5", changes[state].tone, className)}>
      <ChangeGlyph state={state} className="size-3" />
      {CHANGE_WORDS[state]}
    </Badge>
  )
}
