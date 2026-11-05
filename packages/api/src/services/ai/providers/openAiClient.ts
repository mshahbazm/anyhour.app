import OpenAI from 'openai'
import { vendorKey } from '../../../env'
import { ProviderUnconfiguredError } from './errors'

let openai: OpenAI | undefined

// One client for every OpenAI call (language models and Decisions).
export function getOpenAi() {
  const apiKey = vendorKey('openai')
  if (!apiKey) throw new ProviderUnconfiguredError('openai')
  openai ??= new OpenAI({ apiKey })
  return openai
}
