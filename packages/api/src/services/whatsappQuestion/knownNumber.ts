import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import { connection, organization } from '../../db/schema'
import type { iWhatsappNumberLookup } from '../../types/whatsappQuestion.types'
import { parseWhatsappNumber } from './number'

// The business's WhatsApp number (docs/whatsappQuestion.md, Revision 2): its
// WhatsApp channel's number, else the one read from Your business (contact
// details). Read whenever it's needed, never stored with the question.
export async function knownWhatsappNumber(
  organizationId: string,
): Promise<iWhatsappNumberLookup> {
  const [channel] = await db
    .select({ settings: connection.settings })
    .from(connection)
    .where(
      and(
        eq(connection.organizationId, organizationId),
        eq(connection.provider, 'whatsapp_business'),
        eq(connection.status, 'active'),
      ),
    )
    .limit(1)
  const shown =
    channel?.settings.displayPhoneNumber &&
    parseWhatsappNumber(channel.settings.displayPhoneNumber)
  if (shown) return { number: shown, source: 'channel' }
  const [workspace] = await db
    .select({ contactDetails: organization.contactDetails })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1)
  const whatsapp = workspace?.contactDetails?.whatsapp
  return whatsapp
    ? { number: whatsapp.value, source: whatsapp.source }
    : { number: null, source: null }
}
