import {
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDot,
  CircleDashed,
  CircleMinus,
  CircleX,
  Diamond,
  LoaderCircle,
  Triangle,
} from "lucide-react"
import { cn } from "@/lib/utils"

const meanings = {
  critical: { icon: Diamond, tone: "fill-sev-critical-solid text-sev-critical-solid" },
  warning: { icon: Triangle, tone: "fill-sev-warning-solid text-sev-warning-solid" },
  info: { icon: Circle, tone: "fill-sev-info-solid text-sev-info-solid" },
  pass: { icon: CircleCheck, tone: "text-status-pass" },
  finished: { icon: CircleCheck, tone: "text-muted-foreground" },
  fail: { icon: CircleX, tone: "text-sev-critical" },
  "could-not-check": { icon: CircleDashed, tone: "text-muted-foreground" },
  "not-applicable": { icon: CircleMinus, tone: "text-muted-foreground" },
  queued: { icon: Circle, tone: "text-muted-foreground" },
  running: { icon: LoaderCircle, tone: "animate-spin text-primary motion-reduce:animate-none" },
  partial: { icon: CircleAlert, tone: "text-sev-warning" },
  captured: { icon: CircleDot, tone: "text-muted-foreground" },
  failed: { icon: CircleX, tone: "text-sev-critical" },
  none: { icon: CircleMinus, tone: "text-muted-foreground" },
} as const

export type StatusMeaning = keyof typeof meanings

export function StatusGlyph({
  meaning,
  className,
}: {
  meaning: StatusMeaning
  className?: string
}) {
  const { icon: Icon, tone } = meanings[meaning]
  return <Icon aria-hidden="true" className={cn("size-4 shrink-0", tone, className)} />
}
