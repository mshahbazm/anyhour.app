import { and, eq, sql } from 'drizzle-orm'
import { db } from '../../db'
import { connection } from '../../db/schema'
import { sealCredentials } from '../connections/credentials'
import { ConnectionError } from '../connections/errors'
import { providerFor } from '../connections/registry'
import { connectionList } from '../connections/store'
import { whatsappBusinessActions } from '../connections/whatsappBusinessApi'
import { workspaceAi } from '../assistants/workspaceAi'
import { ApiError } from '../http/apiError'

// Connecting the business's WhatsApp number on Channels: the owner pastes
// the phone number id, the WhatsApp Business Account id and a permanent
// (system user) access token. We check them with Meta, subscribe our app to
// the account's webhooks and store the token encrypted. Embedded Signup can
// replace the pasting later.
export async function connectWhatsappBusiness(input: {
  organizationId: string
  memberId: string
  phoneNumberId: string
  businessAccountId: string
  accessToken: string
}) {
  if (!providerFor('whatsapp_business')?.available())
    throw new ApiError(
      503,
      'connection_unavailable',
      'This app isn’t available yet.',
    )
  const { id: assistantId } = await workspaceAi(input.organizationId)
  const [taken] = await db
    .select()
    .from(connection)
    .where(
      and(
        eq(connection.provider, 'whatsapp_business'),
        eq(connection.externalAccountId, input.phoneNumberId),
      ),
    )
  if (taken && taken.organizationId !== input.organizationId)
    throw new ApiError(
      409,
      'connection_in_use',
      'That number is already connected to another Anyhour workspace.',
    )
  let number
  try {
    number = await whatsappBusinessActions.phoneNumber(
      input.phoneNumberId,
      input.accessToken,
    )
    await whatsappBusinessActions.subscribe(
      input.businessAccountId,
      input.accessToken,
    )
  } catch (error) {
    if (!(error instanceof ConnectionError)) throw error
    throw new ApiError(
      422,
      'whatsapp_rejected',
      error.failure === 'unauthorized'
        ? 'Meta didn’t accept that access token.'
        : error.failure === 'unavailable' || error.failure === 'rateLimited'
          ? 'WhatsApp didn’t answer. Try again in a minute.'
          : 'Meta didn’t accept those ids with this token. Check both ids.',
    )
  }
  const values = {
    status: 'active' as const,
    assistantId,
    credentialsEncrypted: sealCredentials({ accessToken: input.accessToken }),
    settings: {
      // Template choices survive reconnecting with a new token.
      templateName: taken?.settings.templateName ?? null,
      templateLanguage: taken?.settings.templateLanguage ?? 'en',
      accountName: number.verified_name ?? null,
      displayPhoneNumber: number.display_phone_number ?? null,
      businessAccountId: input.businessAccountId,
    },
    connectedByMemberId: input.memberId,
    lastError: null,
  }
  await db
    .insert(connection)
    .values({
      organizationId: input.organizationId,
      provider: 'whatsapp_business',
      externalAccountId: input.phoneNumberId,
      ...values,
    })
    .onConflictDoUpdate({
      target: [connection.provider, connection.externalAccountId],
      targetWhere: sql`${connection.provider} <> 'website'`,
      set: values,
    })
  return connectionList(input.organizationId, input.memberId)
}
