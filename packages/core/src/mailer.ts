import { Context, Data, type Effect } from "effect"

export class MailerError extends Data.TaggedError("MailerError")<{
  readonly operation: string
  readonly cause: unknown
}> {}

/** The Mailer layer could not be built: a required setting (for example MAIL_FROM) is missing. */
export class MailerConfigError extends Data.TaggedError("MailerConfigError")<{
  readonly message: string
}> {}

export interface MailMessage {
  readonly to: string
  readonly subject: string
  readonly text: string
  /** Optional HTML version; always send `text` too. */
  readonly html?: string
}

/**
 * Transactional email. In production the layer sends through Cloudflare Email Service (the
 * `EMAIL` `send_email` binding); locally it prints the message to the console instead.
 */
export class Mailer extends Context.Service<
  Mailer,
  { readonly send: (message: MailMessage) => Effect.Effect<void, MailerError> }
>()("@repo/core/Mailer") {}
