import { DatabaseLayer } from "@repo/db"
import { Layer, Logger } from "effect"
import { AuthLive } from "./auth-live"
import { BrowserLive } from "./browser"
import { WorkerEnvLive } from "./cloudflare"
import { JobsLive } from "./jobs"
import { LlmLive } from "./llm"
import { MailerLive } from "./mailer"
import { RealtimeLive } from "./realtime"
import { StorageLive } from "./storage"

/**
 * The app's Effect layers. `efforge add` appends new layers to this list, so keep the
 * `Layer.mergeAll(...)` call shape.
 */
export const AppLayer = Layer.mergeAll(
  Logger.layer([Logger.consolePretty()]),
  DatabaseLayer.pipe(Layer.provide(WorkerEnvLive)),
  AuthLive,
  LlmLive,
  JobsLive,
  RealtimeLive,
  BrowserLive,
  StorageLive,
  MailerLive,
  /* efforge:layers */
)
