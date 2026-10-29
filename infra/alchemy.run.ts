import * as Alchemy from "alchemy"
import * as Cloudflare from "alchemy/Cloudflare"
import * as Config from "effect/Config"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"

class StageDatabaseMismatch extends Data.TaggedError("StageDatabaseMismatch")<{
  readonly stage: string
  readonly database: string
}> {
  override get message() {
    return `Stage "${this.stage}" would use database "${this.database}", whose name does not contain the stage. Name the database after the stage (for example zinko_${this.stage.replace(/[^a-z0-9]+/gi, "_")}) so one stage can never write to another stage's data.`
  }
}

const squash = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "")

/**
 * Infrastructure as Effects (Alchemy v2). Run it with:
 *
 *   pnpm dev                          local: Vite + workerd via `alchemy dev` (stage dev_$USER)
 *   pnpm run deploy --stage prod      `alchemy deploy` to Cloudflare (or set $ALCHEMY_STAGE)
 *   pnpm run destroy --stage prod     `alchemy destroy`
 *
 * Every Cloudflare binding of the Worker lives here, in the `env` object of the website below.
 * `efforge add` appends resources above the marker and binds them by the name effect-cf reads
 * (HYPERDRIVE, DB, STORAGE, AUDIT_ROOM, ...), so app code never changes between wrangler and Alchemy.
 */
export default Alchemy.Stack(
  "zinko",
  {
    providers: Cloudflare.providers(),
    // CI shares state through a Cloudflare-hosted store; locally it is a `.alchemy/` folder.
    state: process.env.CI ? Cloudflare.state() : Alchemy.localState(),
  },
  Effect.gen(function* () {
    const stage = (yield* Alchemy.Stack).stage
    // Local means `alchemy dev` (Alchemy's own flag, false for deploy and destroy) on a stage
    // named `dev` or `dev_<user>`; a deployed stage such as `devops` is never local.
    const isDev =
      (yield* Alchemy.AlchemyContext).dev && (stage === "dev" || stage.startsWith("dev_"))
    const databaseUrl = new URL(Redacted.value(yield* Config.Redacted("DATABASE_URL")))
    const origin = {
      scheme: "postgres",
      host: databaseUrl.hostname,
      port: Number(databaseUrl.port || 5432),
      database: databaseUrl.pathname.slice(1),
      user: decodeURIComponent(databaseUrl.username),
      password: Redacted.make(decodeURIComponent(databaseUrl.password)),
    } as const
    // A deployed stage names its database after itself, so a spike or a preview can never be
    // pointed at the shared or the production database.
    if (!isDev && !squash(origin.database).includes(squash(stage))) {
      return yield* Effect.die(new StageDatabaseMismatch({ stage, database: origin.database }))
    }
    const hyperdrive = yield* Cloudflare.Hyperdrive.Connection("Hyperdrive", {
      origin,
      // `pnpm dev` only: the Docker Postgres has no TLS and the local Hyperdrive will not fall back
      dev: {
        ...origin,
        sslmode: ["localhost", "127.0.0.1"].includes(origin.host) ? "disable" : "prefer",
      },
      // writes must be visible to the next read, so only pool connections, don't cache queries
      caching: { disabled: true },
    })
    const betterAuthSecret = yield* Config.Redacted("BETTER_AUTH_SECRET")
    // the public origin; empty lets Better Auth infer it from each request (right for PR previews)
    const betterAuthUrl = yield* Config.String("BETTER_AUTH_URL").pipe(Config.withDefault(""))
    const llmEncryptionKey = yield* Config.Redacted("LLM_ENCRYPTION_KEY")
    const auditWorkflow = Cloudflare.Workflow("Audit", { className: "Audit" })
    const auditRoom = Cloudflare.DurableObject("AuditRoom")
    const admissionGate = Cloudflare.DurableObject("AdmissionGate")
    // A capture engine started by hand (CONTRIBUTING.md). Only local runs honour it, so a
    // deployed Worker never talks to a URL from someone's .env.
    const browserUrl = isDev ? yield* Config.String("BROWSER_URL").pipe(Config.withDefault("")) : ""
    // Local Containers need Docker, so `BROWSER_URL` replaces the container resource and binding.
    // Each container instance is one engine; the AdmissionGate hands them to audits in turn.
    const browserEngines = 3
    const browser =
      browserUrl === ""
        ? Cloudflare.Container("Browser", {
            // This account only creates `durable_object` applications: the image and instance size are
            // chosen by `BrowserContainer` in `start()` (`standard-1`: a capture peaked at 951 MiB on
            // a page making 2,100 requests, and `basic` has 1 GiB), and there is no `maxInstances`.
            schedulingPolicy: "durable_object",
            context: "apps/browser",
          })
        : undefined
    const storage = yield* Cloudflare.R2.Bucket("Storage", {
      // preview stages are destroyed with their PR, even when files were uploaded
      forceDestroy: stage !== "prod",
    })
    const storageSigningSecret = yield* Config.Redacted("STORAGE_SIGNING_SECRET")
    const email = Cloudflare.Email.SendEmail("Email")
    const mailFrom = yield* Config.String("MAIL_FROM")
    // local stages print emails to the console; every other stage sends them
    const mailTransport = yield* Config.String("MAIL_TRANSPORT").pipe(
      Config.withDefault(isDev ? "console" : "cloudflare"),
    )
    // efforge:resources

    // TanStack Start on Workers + static assets. The Worker entry is `src/server.ts`, which also
    // re-exports the Durable Object and Workflow classes that Cloudflare needs on the entry.
    const web = yield* Cloudflare.Website.Vite("web", {
      rootDir: "apps/web",
      main: "src/server.ts",
      env: {
        HYPERDRIVE: hyperdrive,
        BETTER_AUTH_SECRET: betterAuthSecret,
        BETTER_AUTH_URL: betterAuthUrl,
        LLM_ENCRYPTION_KEY: llmEncryptionKey,
        AUDIT_WORKFLOW: auditWorkflow,
        AUDIT_ROOM: auditRoom,
        ADMISSION_GATE: admissionGate,
        ...(browser === undefined
          ? { BROWSER_URL: browserUrl }
          : {
              BROWSER: Cloudflare.DurableObject("BrowserContainer", { containers: [browser] }),
              BROWSER_ENGINES: String(browserEngines),
            }),
        // set on local dev stages only: lets a site be on localhost (server/clients.ts)
        ...(isDev ? { ALLOW_PRIVATE_SITES: "true" } : {}),
        STORAGE: storage,
        STORAGE_SIGNING_SECRET: storageSigningSecret,
        EMAIL: email,
        MAIL_FROM: mailFrom,
        MAIL_TRANSPORT: mailTransport,
      },
    })

    return { url: web.url.as<string>() }
  }),
)
