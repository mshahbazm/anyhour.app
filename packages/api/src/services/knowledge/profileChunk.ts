import { embeddingModel } from '../../config/models.config'
import { encodingForModel } from 'js-tiktoken'
import type { iPageProfile } from './cleanup/types'

const encoder = encodingForModel(embeddingModel.id)
export const profileChunkTokenLimit = 300
// Keep tool results bounded even when many links share one embedded label.
export const profileChunkActionLimit = 12
// Content positions start at zero. The existing source/position uniqueness
// constraint also ensures a single profile per page.
export const profileChunkPosition = -1

const clean = (value: string) => value.replace(/\s+/gu, ' ').trim()
const unique = (values: string[]) => [
  ...new Set(values.map(clean).filter(Boolean)),
]

export function buildProfileChunk(
  title: string | null,
  profile: iPageProfile | null,
) {
  if (!profile) return null
  // Priority is deliberate: truncate the tail, never reorder by field length.
  const fields = [
    ['Title', clean(title ?? '')],
    ['Purposes', unique(profile.purposes).join('; ')],
    ['Visitor goals', unique(profile.visitorGoals).join('; ')],
    [
      'Actions',
      unique(profile.actions.map((action) => action.label)).join('; '),
    ],
    ['Topics', unique(profile.topics).join('; ')],
    ['Summary', clean(profile.summary)],
  ]
  const text = fields
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n')
  if (!text) return null
  // Tokenize only enough of the prefix to fill the budget. Very long Unicode
  // action lists need not be tokenized in full just to discard their tail.
  let prefixLength = Math.min(text.length, 2048)
  let tokens = encoder.encode(text.slice(0, prefixLength), [], [])
  while (
    tokens.length <= profileChunkTokenLimit &&
    prefixLength < text.length
  ) {
    prefixLength = Math.min(text.length, prefixLength * 2)
    tokens = encoder.encode(text.slice(0, prefixLength), [], [])
  }
  if (tokens.length <= profileChunkTokenLimit) return text
  // A BPE token boundary can split a Unicode character. Back up until decoding
  // is clean and re-encoding confirms the actual persisted text fits the cap.
  let end = profileChunkTokenLimit
  while (end > 0) {
    const truncated = encoder.decode(tokens.slice(0, end)).trimEnd()
    if (
      !truncated.endsWith('\uFFFD') &&
      encoder.encode(truncated, [], []).length <= profileChunkTokenLimit
    )
      return truncated
    end--
  }
  return null
}

export function profileChunkActions(
  text: string,
  actions: iPageProfile['actions'],
) {
  const labels =
    text
      .split('\n')
      .find((line) => line.startsWith('Actions: '))
      ?.slice('Actions: '.length) ?? ''
  // Reconstruct the ordered labels instead of searching for substrings. A
  // truncated "Book a meeting" must not match a different action called "Book",
  // and semicolons inside a label are not separate actions.
  const included = new Set<string>()
  let offset = 0
  for (const label of unique(actions.map((action) => action.label))) {
    const remaining = labels.slice(offset)
    if (remaining !== label && !remaining.startsWith(`${label}; `)) break
    included.add(label)
    offset += label.length + 2
  }
  const seen = new Set<string>()
  return actions.filter((action) => {
    if (
      seen.size >= profileChunkActionLimit ||
      !included.has(clean(action.label)) ||
      seen.has(action.url)
    )
      return false
    seen.add(action.url)
    return true
  })
}
