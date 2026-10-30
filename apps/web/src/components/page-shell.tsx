import { createContext, useContext, type ComponentProps } from "react"
import { cn } from "@/lib/utils"

const WIDTH = {
  /** Tables, the audit workspace and anything that wants the room: the page width, capped on very wide screens. */
  full: "max-w-[100rem]",
  /** Forms and prose (64rem of content, the page padding added): lines stay readable, the left edge stays where every other page starts. */
  readable: "max-w-[67rem]",
} as const

const Framed = createContext(false)

/**
 * The one frame of every `/app` page: the padding around it, the width, and the vertical rhythm.
 * `main` carries no padding, so a page that skips the shell would touch the screen edge.
 * Pair it with `PageHeader`, whose breadcrumb row keeps the title at the same height on every page.
 * Inside another shell (an audit tab, or a loading skeleton of one) it only keeps the rhythm, so
 * the frame is never doubled.
 */
export function PageShell({
  width = "full",
  className,
  ...props
}: ComponentProps<"div"> & { width?: keyof typeof WIDTH }) {
  const framed = useContext(Framed)
  return (
    <Framed value>
      <div
        data-slot="page-shell"
        className={cn(
          "min-w-0 space-y-6",
          !framed && ["w-full p-4 md:p-6 print:p-0", WIDTH[width]],
          className,
        )}
        {...props}
      />
    </Framed>
  )
}
