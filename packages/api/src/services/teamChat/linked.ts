import { and, eq, isNotNull } from 'drizzle-orm'
import { db } from '../../db'
import { connection, connectionMember, whatsappAgent } from '../../db/schema'

// Whether alerts can reach someone in this workspace in a chat app.
export async function teamChatLinked(organizationId: string) {
  const [[agent], [member]] = await Promise.all([
    db
      .select({ id: whatsappAgent.id })
      .from(whatsappAgent)
      .where(
        and(
          eq(whatsappAgent.organizationId, organizationId),
          eq(whatsappAgent.status, 'linked'),
        ),
      )
      .limit(1),
    db
      .select({ id: connectionMember.id })
      .from(connectionMember)
      .innerJoin(connection, eq(connection.id, connectionMember.connectionId))
      .where(
        and(
          eq(connection.organizationId, organizationId),
          eq(connection.status, 'active'),
          isNotNull(connectionMember.memberId),
        ),
      )
      .limit(1),
  ])
  return Boolean(agent || member)
}
