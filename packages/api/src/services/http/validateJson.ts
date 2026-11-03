import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { ApiError } from './apiError'

export function validateJson<tSchema extends z.ZodType>(schema: tSchema) {
  return zValidator('json', schema, (result) => {
    if (!result.success)
      throw new ApiError(422, 'invalid_request', 'Invalid request body')
  })
}
