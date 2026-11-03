import { z } from 'zod'
import { isTimeZone } from '../services/workspace/businessHours'

const httpUrl = z
  .url()
  .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol))

// The browser's IANA time zone ("Europe/London"); opening hours are local to it.
const timeZone = z.string().trim().refine(isTimeZone, 'Unknown time zone')

// Sign-up onboarding: creates the user's workspace and its AI with the name
// they chose, and starts reading the website into Your business when one is
// given. With a workspace that has no AI yet, that one is filled in instead.
export const createWorkspaceSchema = z.object({
  aiName: z.string().trim().min(1).max(120).optional(),
  organizationId: z.string().min(1).optional(),
  websiteUrl: httpUrl.optional(),
  timeZone: timeZone.optional(),
})

export const updateWorkspaceSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    businessAbout: z.string().trim().max(2000).nullable().optional(),
    // The leads the business wants, in plain words; leads are scored against it.
    idealCustomerProfile: z.string().trim().max(2000).nullable().optional(),
    timeZone: timeZone.optional(),
  })
  .refine((value) => Object.keys(value).length > 0)

export type tCreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>
