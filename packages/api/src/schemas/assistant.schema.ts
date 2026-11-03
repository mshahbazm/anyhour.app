import {
  appearanceLimits,
  launcherIcons,
  launcherStyles,
} from '../config/appearance.config'
import { z } from 'zod'
import {
  botPictureConfig,
  botPictureStyleIds,
} from '../config/botPicture.config'
import { jobLength } from '../config/onboarding.config'
import { trackingOptions } from '../config/tracking.config'
import type { tTrackingOption } from '../config/tracking.config'

const httpUrl = z
  .url()
  .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol))
const origin = z.url().transform((value) => new URL(value).origin)

// What the AI does, in one plain sentence.
export const jobSchema = z.string().trim().min(1).max(jobLength)

export const updateAssistantSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    job: jobSchema.nullable().optional(),
    goal: z.enum(['answers', 'enquiries', 'both']).nullable().optional(),
    goalNotes: z.string().trim().max(2000).nullable().optional(),
    welcomeMessage: z.string().max(500).optional(),
    appearance: z
      .object({
        brandColor: z
          .string()
          .regex(/^#[0-9a-f]{6}$/i, 'Use a colour like #2563eb')
          .nullable(),
        launcher: z.enum(launcherStyles),
        launcherIcon: z.enum(launcherIcons).optional(),
        launcherLabel: z
          .string()
          .trim()
          .max(appearanceLimits.launcherLabelLength)
          .optional(),
        starterPrompts: z
          .array(
            z.string().trim().min(1).max(appearanceLimits.starterPromptLength),
          )
          .max(appearanceLimits.starterPrompts),
      })
      .optional(),
    // Website insights: count visits and visitors on the website.
    tracking: z.boolean().optional(),
    // What is counted while that's on.
    trackingOptions: z
      .object(
        Object.fromEntries(
          trackingOptions.map((option) => [option, z.boolean()]),
        ) as Record<tTrackingOption, z.ZodBoolean>,
      )
      .optional(),
    status: z.enum(['draft', 'published']).optional(),
    allowedOrigins: z.array(origin).max(20).optional(),
    refreshIntervalHours: z
      .number()
      .int()
      .min(1)
      .max(24 * 365)
      .nullable()
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0)

export const createSourceSchema = z.object({
  kind: z.enum(['website', 'webPage', 'publicDocument']),
  url: httpUrl,
  includePaths: z.array(z.string().startsWith('/')).default([]),
  excludePaths: z.array(z.string().startsWith('/')).default([]),
})

export const updateSourceSchema = z
  .object({
    isIncluded: z.boolean().optional(),
    isPinned: z.boolean().optional(),
    includePaths: z.array(z.string().startsWith('/')).optional(),
    excludePaths: z.array(z.string().startsWith('/')).optional(),
  })
  .refine((value) => Object.keys(value).length > 0)

export const createBotPictureSchema = z.object({
  style: z.enum(botPictureStyleIds).nullable().default(null),
  description: z
    .string()
    .trim()
    .max(botPictureConfig.maxDescriptionLength)
    .nullable()
    .default(null),
})
export type tCreateBotPicture = z.infer<typeof createBotPictureSchema>

export const updateKnowledgeNoteSchema = z.object({
  title: z.string().trim().min(1).max(120),
  text: z.string().trim().min(1).max(20_000),
  // Pages the owner confirmed this note overrides, with what each one says.
  overrides: z
    .array(
      z.object({
        sourceId: z.string().min(1),
        excerpt: z.string().trim().min(1).max(1000),
      }),
    )
    .max(20)
    .optional(),
})
// fromMessageId: the staff reply this note was learned from, when the
// person saved the AI's offer to remember it (an answer learned).
export const createKnowledgeNoteSchema = updateKnowledgeNoteSchema.extend({
  fromMessageId: z.string().min(1).optional(),
})

export const noteConflictsSchema = z.object({
  noteId: z.string().min(1).nullable(),
  title: z.string().trim().min(1).max(120),
  text: z.string().trim().min(1).max(20_000),
})

export const resolveCorrectionSchema = z.object({
  decision: z.enum(['keep', 'useWebsite']),
})
