import { authRoute } from "./auth-route"
import { auditRoomRoute } from "./audit-room-route"
import { registerRoute } from "./register-route"
import { reportRoute } from "./report-route"
import { storageRoute } from "./storage-route"
/** Handles a request outside the TanStack router (WebSocket upgrades, file downloads), or returns undefined. */
export type WorkerRoute = (request: Request) => Promise<Response | undefined>

/** Tried in order before the app. `efforge add` appends routes to this list. */
export const workerRoutes: ReadonlyArray<WorkerRoute> = [
  /* efforge:routes */ authRoute,
  auditRoomRoute,
  storageRoute,
  reportRoute,
  registerRoute,
]
