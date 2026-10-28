import { Layer, Logger } from "effect"
import { AuthLive } from "./auth-live"
import { BrowserLive } from "./browser"
import { WorkerEnvLive } from "./cloudflare"
import { DatabaseLive } from "./database-live"
import { JobsLive } from "./jobs"
import { LlmLive } from "./llm"
import { MailerLive } from "./mailer"
import { AuditProgressLive } from "./audit-progress"
import { CaptureAdmissionLive } from "./admission"
import { StorageLive } from "./storage"

/**
 * The app's Effect layers. `efforge add` appends new layers to this list, so keep the
 * `Layer.mergeAll(...)` call shape.
 */
export const AppLayer = Layer.mergeAll(
  Logger.layer([Logger.consolePretty()]),
  DatabaseLive,
  AuthLive,
  LlmLive,
  JobsLive,
  AuditProgressLive,
  BrowserLive,
  CaptureAdmissionLive,
  StorageLive,
  MailerLive,
  WorkerEnvLive,
  /* efforge:layers */
)
