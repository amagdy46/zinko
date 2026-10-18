import { Mailer } from "@repo/core/mailer"
import { Effect, ManagedRuntime } from "effect"
import { MailerLive } from "./mailer"

// Better Auth calls this from inside `makeAuth`, which the app layers import, so it can't reach
// back into `runtime` (an import cycle). The Mailer needs nothing but the Worker env: own runtime.
const mailRuntime = ManagedRuntime.make(MailerLive)

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

interface Invitation {
  readonly id: string
  readonly email: string
  readonly organization: { readonly name: string }
  readonly inviter: { readonly user: { readonly name: string } }
}

/**
 * `organization({ sendInvitationEmail })`: emails the invite link. A failed send is logged, not
 * thrown, so the invitation still exists and the link shown to the inviter keeps working.
 */
export const sendInvitationEmail = (data: Invitation, request?: Request): Promise<void> => {
  if (request === undefined) return Promise.resolve()
  const link = `${new URL(request.url).origin}/accept-invite/${data.id}`
  const { name } = data.organization
  const inviter = data.inviter.user.name
  return mailRuntime.runPromise(
    Effect.gen(function* () {
      const mailer = yield* Mailer
      yield* mailer.send({
        to: data.email,
        subject: `${inviter} invited you to ${name}`,
        text: `${inviter} invited you to join ${name}.\n\nAccept the invitation: ${link}\n`,
        html: `<p>${escapeHtml(inviter)} invited you to join <strong>${escapeHtml(name)}</strong>.</p><p><a href="${escapeHtml(link)}">Accept the invitation</a></p>`,
      })
    }).pipe(Effect.catch((error) => Effect.logError("Could not send the invitation email", error))),
  )
}
