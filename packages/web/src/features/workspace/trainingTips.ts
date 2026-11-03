import { useCallback, useState } from 'react'
import type { iAssistant, iKnowledgeGap } from './types'
import type { tRuleTag } from '../memberRules/api'

export interface iTrainingTip {
  id: string
  label: string
  /** Sent to the bot when the owner taps the tip. */
  prompt: string
}

// Rule topics in the order your AI asks about them (see
// systemPrompt.ts), each shown until it has a rule with that tag.
const ruleTips: Array<[tRuleTag, string, string]> = [
  [
    'askFirst',
    'What should I ask visitors first?',
    'I want to give you a rule about what to find out from visitors before you recommend something or pass them on',
  ],
  [
    'handOver',
    'When should my team take over?',
    'I want to give you a rule about when to hand a visitor over to my team',
  ],
  ['tone', 'How should I sound?', 'I want to set how you sound with visitors'],
  [
    'never',
    'Anything I should never say?',
    'I want to give you a rule about what never to say or do with visitors',
  ],
]

function ruleTip(tag: tRuleTag): iTrainingTip | undefined {
  const tip = ruleTips.find(([id]) => id === tag)
  return tip && { id: `rule:${tip[0]}`, label: tip[1], prompt: tip[2] }
}

function shorten(text: string, length: number) {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > length ? `${clean.slice(0, length - 1)}…` : clean
}

// A visitor question the bot couldn't answer; tapping it starts teaching.
export function gapTip(gap: iKnowledgeGap): iTrainingTip {
  return {
    id: `gap:${gap.id}`,
    label: `Answer “${shorten(gap.question, 48)}”`,
    prompt: `I want to teach you the answer to “${shorten(gap.question, 300)}” — a visitor asked this and you couldn’t answer.`,
  }
}

// Real gaps first: visitor questions it couldn't answer, no knowledge, then
// rule topics it has no rule for yet.
export function trainingTips(input: {
  bot: iAssistant | undefined
  knowledgeCount: number
  gaps: iKnowledgeGap[]
  /** Tags of the rules it has; null while they load (no rule tips yet). */
  ruleTags: string[] | null
}): iTrainingTip[] {
  if (!input.bot) return []
  const tips = input.gaps.slice(0, 3).map(gapTip)
  if (!input.knowledgeCount)
    tips.push({
      id: 'knowledge:first',
      label: 'Tell me about your business',
      prompt: 'I want to tell you about my business',
    })
  if (!input.ruleTags) return tips
  for (const [tag] of ruleTips)
    if (!input.ruleTags.includes(tag)) {
      const tip = ruleTip(tag)
      if (tip) tips.push(tip)
    }
  return tips
}

// Tips the owner already tapped stay hidden for that bot, on this browser.
export function useUsedTips(botId: string | null) {
  const key = `anyhour:usedTips:${botId}`
  const [used, setUsed] = useState<{ key: string; ids: string[] }>(() => ({
    key,
    ids: read(key),
  }))
  const ids = used.key === key ? used.ids : read(key)
  if (used.key !== key) setUsed({ key, ids })

  const markUsed = useCallback(
    (id: string) => {
      setUsed((current) => {
        const next = [...new Set([...current.ids, id])].slice(-100)
        try {
          localStorage.setItem(key, JSON.stringify(next))
        } catch {
          /* Remembering used tips is optional. */
        }
        return { key, ids: next }
      })
    },
    [key],
  )
  return { used: new Set(ids), markUsed }
}

function read(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}
