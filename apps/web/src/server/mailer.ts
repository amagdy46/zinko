import { Mailer, MailerConfigError, MailerError } from "@repo/core/mailer"
import { Config, Effect, Layer, Option } from "effect"
import { Email, WorkerConfig } from "effect-cf"
import { WorkerEnvLive } from "./cloudflare"

/** The `EMAIL` `send_email` binding (see wrangler.jsonc or infra/alchemy.run.ts). */
class EmailBinding extends Email.Tag<EmailBinding>()("EmailBinding") {}

/** Prints each message instead of sending it, so invitations and receipts are visible in `pnpm dev`. */
const ConsoleMailer = (from: string) =>
  Layer.succeed(
    Mailer,
    Mailer.of({
      send: (message) =>
        Effect.log(
          `[mail] from ${from} to ${message.to}\nSubject: ${message.subject}\n\n${message.text}`,
        ),
    }),
  )

/** Sends through Cloudflare Email Service. `from` must be an address on a domain onboarded to Email Sending. */
const CloudflareMailer = (from: string) =>
  Layer.effect(
    Mailer,
    Effect.gen(function* () {
      const email = yield* EmailBinding
      return Mailer.of({
        send: ({ to, subject, text, html }) =>
          email.send({ from, to, subject, text, ...(html === undefined ? {} : { html }) }).pipe(
            Effect.asVoid,
            Effect.mapError((cause) => new MailerError({ operation: "send", cause })),
          ),
      })
    }),
  ).pipe(Layer.provide(EmailBinding.layer({ binding: "EMAIL" })))

/**
 * `Mailer`, chosen by MAIL_TRANSPORT: `console` (local development, prints the message) or
 * `cloudflare` (the default). The Cloudflare transport needs MAIL_FROM, checked when the layer is built.
 */
export const MailerLive = Layer.unwrap(
  Effect.gen(function* () {
    const provider = yield* WorkerConfig.provider
    const transport = Option.getOrElse(
      yield* Config.option(Config.String("MAIL_TRANSPORT")).parse(provider),
      () => "cloudflare",
    )
    const from = yield* Config.option(Config.String("MAIL_FROM")).parse(provider)
    if (transport === "console")
      return ConsoleMailer(Option.getOrElse(from, () => "noreply@localhost"))
    if (Option.isNone(from) || from.value === "")
      return yield* new MailerConfigError({
        message:
          "MAIL_FROM is not set. Set it to an address on a domain enabled for Cloudflare Email Sending (wrangler email sending enable <domain>), or set MAIL_TRANSPORT=console to print emails instead.",
      })
    return CloudflareMailer(from.value)
  }),
).pipe(Layer.provide(WorkerEnvLive))
