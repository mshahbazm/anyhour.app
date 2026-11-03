// What was typed before the workspace exists, so a reload resumes there
// instead of starting over. Kept per account in this browser; storage is
// optional and onboarding works without it.

export const draftSteps = ['name', 'website'] as const
export type tDraftStep = (typeof draftSteps)[number]

export interface iOnboardingDraft {
  step: tDraftStep
  aiName: string
  website: string
}

const key = (account: string) => `anyhour:onboarding:${account}`

// The AI's name until the owner picks another; mirrors defaultAiName in
// packages/api/src/config/onboarding.config.ts.
export const defaultAiName = 'Paige'

export const emptyDraft: iOnboardingDraft = {
  step: 'name',
  aiName: defaultAiName,
  website: '',
}

export function readDraft(account: string): iOnboardingDraft {
  try {
    const saved = JSON.parse(
      localStorage.getItem(key(account)) ?? 'null',
    ) as Partial<iOnboardingDraft> | null
    if (!saved || typeof saved !== 'object') return emptyDraft
    return {
      step: draftSteps.find((step) => step === saved.step) ?? 'name',
      aiName:
        typeof saved.aiName === 'string'
          ? saved.aiName.slice(0, 120)
          : defaultAiName,
      website: typeof saved.website === 'string' ? saved.website : '',
    }
  } catch {
    return emptyDraft
  }
}

export function saveDraft(account: string, draft: iOnboardingDraft | null) {
  try {
    if (draft) localStorage.setItem(key(account), JSON.stringify(draft))
    else localStorage.removeItem(key(account))
  } catch {
    /* Resuming is a convenience; onboarding works without it. */
  }
}
