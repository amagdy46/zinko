import { Mailer } from "@repo/core/mailer"
import { Effect, ManagedRuntime } from "effect"
import { MailerLive } from "./mailer"

// Same reason as invitation-email.ts: Better Auth calls this from inside `makeAuth`, so it can't
// reach back into `runtime`.
const mailRuntime = ManagedRuntime.make(MailerLive)

/**
 * `emailAndPassword({ sendResetPassword })`: emails the reset link. A failed send is logged, not
 * thrown, so the response is the same whether or not the address has an account.
 */
export const sendResetPasswordEmail = (data: {
  readonly user: { readonly email: string; readonly name: string }
  readonly url: string
}): Promise<void> =>
  mailRuntime.runPromise(
    Effect.gen(function* () {
      const mailer = yield* Mailer
      yield* mailer.send({
        to: data.user.email,
        subject: "Reset your Zinko password",
        text: `Hi ${data.user.name},\n\nUse this link to choose a new password. It works once and expires in an hour:\n${data.url}\n\nIf you did not ask for this, ignore this email: your password stays the same.\n`,
      })
    }).pipe(
      Effect.catch((error) => Effect.logError("Could not send the password reset email", error)),
    ),
  )
