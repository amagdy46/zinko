import { type BetterAuthOptions, betterAuth } from "better-auth"
import { organization } from "better-auth/plugins"
import { sendInvitationEmail } from "./invitation-email"

export interface AuthSettings {
  readonly database: NonNullable<BetterAuthOptions["database"]>
  readonly secret: string
  readonly baseURL: string | undefined
  /** Local dev stages only: no fixed origin (Vite moves to the next free port), so trust any localhost port. */
  readonly local: boolean
  /**
   * Report logo objects outlive the database rows an organization deletion cascades over, so the
   * deletion goes through these: `collect` runs before it (and throws to stop it), `purge` after.
   */
  readonly organizationFiles: {
    readonly collect: (organizationId: string) => Promise<void>
    readonly purge: () => Promise<void>
  }
}

const localhostOrigins = {
  allowedHosts: ["localhost:*", "127.0.0.1:*"],
  protocol: "http" as const,
}

/**
 * Better Auth for one request scope (see auth-live.ts). `efforge add` appends plugins to the
 * `plugins` list, so keep the `plugins: [...]` array shape.
 */
export const makeAuth = ({ database, secret, baseURL, local, organizationFiles }: AuthSettings) => {
  const origin = baseURL ?? (local ? localhostOrigins : undefined)
  return betterAuth({
    database,
    secret,
    ...(origin === undefined ? {} : { baseURL: origin }),
    emailAndPassword: { enabled: true },
    plugins: [
      /* efforge:auth-plugins */ organization({
        sendInvitationEmail,
        organizationHooks: {
          beforeDeleteOrganization: ({ organization: deleted }) =>
            organizationFiles.collect(deleted.id),
          afterDeleteOrganization: () => organizationFiles.purge(),
        },
      }),
    ],
  })
}

export type AuthInstance = ReturnType<typeof makeAuth>
