import { asc, eq } from 'drizzle-orm'
import { db } from '../../db'
import { member, user } from '../../db/schema'

export interface iRecipient {
  memberId: string
  name: string
  email: string
}

const hasRole = (roles: string, role: string) =>
  roles.split(',').some((item) => item.trim() === role)

// Who "owner" means for a workspace: its owner, or its admins when it has none.
export async function workspaceOwners(
  organizationId: string,
): Promise<iRecipient[]> {
  const people = await db
    .select({
      memberId: member.id,
      role: member.role,
      name: user.name,
      email: user.email,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, organizationId))
    .orderBy(asc(member.createdAt))
  const owners = people.filter((person) => hasRole(person.role, 'owner'))
  const chosen = owners.length
    ? owners
    : people.filter((person) => hasRole(person.role, 'admin'))
  return chosen.map(({ memberId, name, email }) => ({ memberId, name, email }))
}
