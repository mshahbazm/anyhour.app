import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm'
import { db } from '../../db'
import { knowledgeSource, organization } from '../../db/schema'
import { businessOwner, ownedBy } from '../knowledge/owner'
import { ApiError } from '../http/apiError'
import type { tBusinessHours } from '../../types/businessHours.types'
import type { iContactDetails } from '../../types/contactDetails.types'

export interface iBusinessProfile {
  name: string
  website: string | null
  about: string | null
  topics: string[]
}

// GET .../business: the profile plus the opening hours read from Your
// business (Monday first; null until found), their IANA time zone and the
// contact details read from it (null until read).
export interface iBusinessPage extends iBusinessProfile {
  businessHours: tBusinessHours | null
  timeZone: string | null
  contactDetails: iContactDetails | null
}

function homeKey(url: string | null) {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname.replace(/\/+$/, '')}`
  } catch {
    return null
  }
}

// What the business is about: the owner's text first, otherwise the profile of
// the homepage of the first website in Your business.
export async function getBusinessProfile(
  organizationId: string,
): Promise<iBusinessPage> {
  const [workspace] = await db
    .select({
      name: organization.name,
      about: organization.businessAbout,
      businessHours: organization.businessHours,
      timeZone: organization.timeZone,
      contactDetails: organization.contactDetails,
    })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1)
  if (!workspace)
    throw new ApiError(404, 'workspace_missing', 'Workspace not found')
  const [site] = await db
    .select({ url: knowledgeSource.inputUrl })
    .from(knowledgeSource)
    .where(
      and(
        ownedBy(knowledgeSource, businessOwner(organizationId)),
        eq(knowledgeSource.kind, 'website'),
        isNull(knowledgeSource.parentId),
      ),
    )
    .orderBy(asc(knowledgeSource.createdAt))
    .limit(1)
  const website = site?.url ?? null
  const home = homeKey(website)
  const hours = {
    businessHours: workspace.businessHours,
    timeZone: workspace.timeZone,
    contactDetails: workspace.contactDetails,
  }
  const told = {
    name: workspace.name,
    website,
    about: workspace.about,
    topics: [],
    ...hours,
  }
  if (workspace.about || !home) return told

  // Match URLs first; only the homepage's profile JSON is loaded.
  const candidates = await db
    .select({
      id: knowledgeSource.id,
      url: knowledgeSource.canonicalUrl,
      inputUrl: knowledgeSource.inputUrl,
    })
    .from(knowledgeSource)
    .where(
      and(
        ownedBy(knowledgeSource, businessOwner(organizationId)),
        isNotNull(knowledgeSource.pageProfile),
      ),
    )
  const match = candidates.find(
    (row) => homeKey(row.url) === home || homeKey(row.inputUrl) === home,
  )
  const [homepageRow] = match
    ? await db
        .select({ profile: knowledgeSource.pageProfile })
        .from(knowledgeSource)
        .where(eq(knowledgeSource.id, match.id))
        .limit(1)
    : []
  const homepage = homepageRow?.profile
  if (!homepage) return told
  return {
    name: workspace.name,
    website,
    about: [homepage.summary, ...homepage.purposes].filter(Boolean).join(' '),
    topics: homepage.topics,
    ...hours,
  }
}
