import { type BetterAuthOptions, betterAuth } from 'better-auth'
import { organization } from 'better-auth/plugins'
import { sendInvitationEmail } from './invitation-email'

export interface AuthSettings {
  readonly database: NonNullable<BetterAuthOptions['database']>
  readonly secret: string
  readonly baseURL: string | undefined
}

/**
 * Better Auth for one request scope (see auth-live.ts). `efforge add` appends plugins to the
 * `plugins` list, so keep the `plugins: [...]` array shape.
 */
export const makeAuth = ({ database, secret, baseURL }: AuthSettings) =>
  betterAuth({
    database,
    secret,
    ...(baseURL === undefined ? {} : { baseURL }),
    emailAndPassword: { enabled: true },
    plugins: [/* efforge:auth-plugins */ organization({ sendInvitationEmail })],
  })

export type AuthInstance = ReturnType<typeof makeAuth>
