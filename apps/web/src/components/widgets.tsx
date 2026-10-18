import type { ReactNode } from "react"
import { RealtimeDemo } from "./realtime-demo"

/** Cards shown on the dashboard. `efforge add` appends add-on demos to this list. */
export const widgets: ReadonlyArray<ReactNode> = [
  /* efforge:widgets */ <RealtimeDemo key="realtime" />,
]
