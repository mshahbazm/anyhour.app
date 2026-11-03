import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'
import { magicLink, organization } from 'better-auth/plugins'
import { Resend } from 'resend'
import { env } from '../env'
import { db } from '../db'
import * as schema from '../db/schema'
import { ac, roles } from '../config/permissions.config'

function createAuth() {
  const resend = new Resend(env.RESEND_API_KEY)

  async function sendEmail(to: string, subject: string, text: string) {
    const { error } = await resend.emails.send({
      from: env.EMAIL_FROM,
      to: [to],
      subject,
      text,
    })
    if (error) throw new Error('Could not send email')
  }

  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.FRONT_END_URL],
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },
    plugins: [
      magicLink({
        storeToken: 'hashed',
        sendMagicLink: async ({ email, url }) => {
          await sendEmail(
            email,
            'Sign in to Anyhour',
            `Open this link to sign in to Anyhour:\n\n${url}\n\nIf you did not request this, you can ignore this email.`,
          )
        },
      }),
      organization({
        ac,
        roles,
        schema: {
          organization: {
            additionalFields: {
              businessAbout: { type: 'string', required: false, input: false },
              idealCustomerProfile: {
                type: 'string',
                required: false,
                input: false,
              },
            },
          },
        },
        sendInvitationEmail: async ({ email, id, inviter, organization }) => {
          const inviteUrl = new URL(
            `/accept-invitation/${id}`,
            env.FRONT_END_URL,
          )
          await sendEmail(
            email,
            `Join ${organization.name} on Anyhour`,
            `${inviter.user.name} invited you to ${organization.name} on Anyhour.\n\nOpen this link to accept:\n${inviteUrl.toString()}`,
          )
        },
      }),
    ],
  })
}

let authInstance: ReturnType<typeof createAuth> | undefined

export function getAuth() {
  authInstance ??= createAuth()
  return authInstance
}
