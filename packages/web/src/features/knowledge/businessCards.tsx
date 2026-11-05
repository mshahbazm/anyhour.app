import { Building2, Globe } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../workspace/api'
import type { iKnowledgeSource } from '../workspace/types'
import type { tBusinessHours } from './openingHours'
import type { iContactDetails } from './contactDetails'
import { displayUrl } from './sourceState'

// Mirrors iBusinessPage in packages/api/src/services/workspace/businessProfile.ts.
export interface iBusinessProfile {
  name: string
  website: string | null
  about: string | null
  topics: string[]
  /** Opening hours read from Your business, Monday first; null until found. */
  businessHours: tBusinessHours | null
  timeZone: string | null
  /** WhatsApp, phone, email and address read from Your business. */
  contactDetails: iContactDetails | null
}

export function useBusinessProfile(base: string | null, version: string) {
  const [profile, setProfile] = useState<iBusinessProfile | null>(null)
  useEffect(() => {
    if (!base) {
      setProfile(null)
      return
    }
    let current = true
    api<iBusinessProfile>(base)
      .then((value) => current && setProfile(value))
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [base, version])
  return profile
}

function plural(count: number, word: string) {
  return `${count} ${count === 1 ? word : `${word}s`}`
}

/** What Your business holds, in a few words: "1 website · 2 files · 3 notes". */
export function businessCounts(sources: iKnowledgeSource[]) {
  const ids = new Set(sources.map((source) => source.id))
  const roots = sources.filter(
    (source) => !source.parentId || !ids.has(source.parentId),
  )
  const sites = roots.filter((source) => source.kind === 'website').length
  const pages = roots.filter(
    (source) => source.kind === 'webPage' || source.kind === 'publicDocument',
  ).length
  const files = roots.filter((source) => source.kind === 'upload').length
  const notes = roots.filter((source) => source.kind === 'note').length
  return [
    sites && plural(sites, 'website'),
    pages && plural(pages, 'page'),
    files && plural(files, 'file'),
    notes && plural(notes, 'note'),
  ]
    .filter(Boolean)
    .join(' · ')
}

// The top of Your business: what the business is and its website.
export function BusinessProfileCard(props: {
  profile: iBusinessProfile | null
}) {
  const { profile } = props
  return (
    <section className="understandingLead" aria-labelledby="businessName">
      <div className="understandingLeadHead">
        <span id="businessName" className="understandingLabel">
          <Building2 size={13} aria-hidden="true" />
          {profile?.name ?? 'Your business'}
        </span>
      </div>
      <p>
        {profile?.about ??
          'Add your website or a file below, and this fills in once it’s read.'}
      </p>
      {profile?.website && (
        <div className="businessLinks">
          <a
            className="businessLink"
            href={profile.website}
            target="_blank"
            rel="noreferrer"
          >
            <Globe size={14} aria-hidden="true" />
            {displayUrl(profile.website)}
          </a>
        </div>
      )}
    </section>
  )
}
