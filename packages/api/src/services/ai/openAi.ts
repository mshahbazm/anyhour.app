import OpenAI from 'openai'
import { env } from '../../env'
import { ApiError } from '../http/apiError'

let openai: OpenAI | undefined

export function getOpenAi() {
  const apiKey = env.LLM_KEY ?? env.OPENAI_API_KEY
  if (!apiKey)
    throw new ApiError(503, 'ai_unconfigured', 'AI service is not configured')
  openai ??= new OpenAI({ apiKey })
  return openai
}
