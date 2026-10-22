import { cn } from "@/lib/utils"

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" role="img" aria-label="Zinko" className={cn("size-7", className)}>
      <rect
        x="0.5"
        y="0.5"
        width="63"
        height="63"
        rx="14"
        className="fill-sidebar stroke-border"
        strokeWidth="2"
      />
      <g transform="translate(9 7.5625) scale(0.71875)">
        <path
          d="M32 47L13 40M32 47L18.5 26M32 47V20M32 47L45.5 26M32 47L51 40"
          fill="none"
          className="stroke-foreground"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <g className="fill-foreground">
          <circle cx="32" cy="48" r="7" />
          <ellipse cx="13" cy="40" rx="4" ry="6.5" transform="rotate(-70 13 40)" />
          <ellipse cx="18.5" cy="26" rx="4" ry="6.5" transform="rotate(-33 18.5 26)" />
          <ellipse cx="45.5" cy="26" rx="4" ry="6.5" transform="rotate(33 45.5 26)" />
          <ellipse cx="51" cy="40" rx="4" ry="6.5" transform="rotate(70 51 40)" />
        </g>
        <ellipse
          cx="32"
          cy="19"
          rx="6.5"
          ry="5"
          className="fill-sidebar"
          stroke="#8b7cf6"
          strokeWidth="3"
        />
        <circle cx="32" cy="19" r="1.7" fill="#8b7cf6" />
      </g>
    </svg>
  )
}

export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2 font-semibold", className)}>
      <LogoMark />
      Zinko
    </span>
  )
}
