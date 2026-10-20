import * as Alchemy from "alchemy"
import * as Cloudflare from "alchemy/Cloudflare"
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"

/**
 * Infrastructure as Effects (Alchemy v2). Run it with:
 *
 *   pnpm dev                          local: Vite + workerd via `alchemy dev` (stage dev_$USER)
 *   pnpm run deploy --stage prod      `alchemy deploy` to Cloudflare (or set $ALCHEMY_STAGE)
 *   pnpm run destroy --stage prod     `alchemy destroy`
 *
 * Every Cloudflare binding of the Worker lives here, in the `env` object of the website below.
 * `efforge add` appends resources above the marker and binds them by the name effect-cf reads
 * (HYPERDRIVE, DB, STORAGE, ROOM, ...), so app code never changes between wrangler and Alchemy.
 */
export default Alchemy.Stack(
  "zinko",
  {
    providers: Cloudflare.providers(),
    // CI shares state through a Cloudflare-hosted store; locally it is a `.alchemy/` folder.
    state: process.env.CI ? Cloudflare.state() : Alchemy.localState(),
  },
  Effect.gen(function* () {
    const databaseUrl = new URL(Redacted.value(yield* Config.Redacted("DATABASE_URL")))
    const hyperdrive = yield* Cloudflare.Hyperdrive.Connection("Hyperdrive", {
      origin: {
        scheme: "postgres",
        host: databaseUrl.hostname,
        port: Number(databaseUrl.port || 5432),
        database: databaseUrl.pathname.slice(1),
        user: decodeURIComponent(databaseUrl.username),
        password: Redacted.make(decodeURIComponent(databaseUrl.password)),
      },
      // writes must be visible to the next read, so only pool connections, don't cache queries
      caching: { disabled: true },
    })
    const betterAuthSecret = yield* Config.Redacted("BETTER_AUTH_SECRET")
    // the public origin; empty lets Better Auth infer it from each request (right for PR previews)
    const betterAuthUrl = yield* Config.String("BETTER_AUTH_URL").pipe(Config.withDefault(""))
    const llmEncryptionKey = yield* Config.Redacted("LLM_ENCRYPTION_KEY")
    const exampleWorkflow = Cloudflare.Workflow("Example", { className: "Example" })
    const room = Cloudflare.DurableObject("Room")
    const browser = Cloudflare.Container("Browser", {
      className: "BrowserContainer",
      context: "apps/browser",
      // A capture (Node, Python and Chromium) peaked at 534–750 MiB on the `clean` fixture and at
      // 951 MiB on a page making 2,100 requests. Real sites use more, and `basic` (1 GiB, 1/4 vCPU)
      // leaves too little room. 4 GiB, 1/2 vCPU.
      instanceType: "standard-1",
      maxInstances: 2,
    })
    const storage = yield* Cloudflare.R2.Bucket("Storage", {
      // preview stages are destroyed with their PR, even when files were uploaded
      forceDestroy: (yield* Alchemy.Stack).stage !== "prod",
    })
    const storageSigningSecret = yield* Config.Redacted("STORAGE_SIGNING_SECRET")
    const email = Cloudflare.Email.SendEmail("Email")
    const mailFrom = yield* Config.String("MAIL_FROM")
    // local stages print emails to the console; every other stage sends them
    const mailTransport = yield* Config.String("MAIL_TRANSPORT").pipe(
      Config.withDefault((yield* Alchemy.Stack).stage.startsWith("dev") ? "console" : "cloudflare"),
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
        EXAMPLE_WORKFLOW: exampleWorkflow,
        ROOM: room,
        BROWSER: browser,
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
