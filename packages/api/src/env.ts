import { z } from 'zod'
import {
  decisionProviderIds,
  decisionProviderVendors,
  llmProviderIds,
  llmProviderVendors,
  vendorKeys,
  type tVendor,
} from './config/models.config'
import {
  pageReaderProviderIds,
  pageReaderProviderVendors,
} from './config/pageReaders.config'

const httpUrl = z
  .url()
  .refine(
    (value) => ['http:', 'https:'].includes(new URL(value).protocol),
    'Must be an HTTP URL',
  )

const optionalText = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
)

const envSchema = z.object({
  DATABASE_URL: z
    .url()
    .refine(
      (value) => ['postgres:', 'postgresql:'].includes(new URL(value).protocol),
      'Must be a PostgreSQL URL',
    ),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: httpUrl,
  FRONT_END_URL: httpUrl,
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  RESEND_API_KEY: z.string().min(1),
  EMAIL_FROM: z.string().min(1),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  // AI providers (config/models.config.ts): one key per vendor, and each
  // capability picks its provider. The selected providers' keys are required.
  LLM_PROVIDER: z.enum(llmProviderIds).default('openai'),
  OPENAI_API_KEY: optionalText,
  R2_ENDPOINT: httpUrl.optional(),
  R2_BUCKET: z.string().min(1).optional(),
  R2_ACCESS_KEY_ID: z.string().min(1).optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  // Who reads customers' websites (docs/pageReading.md); its vendor key is
  // required. Our own server never fetches a customer's site.
  PAGE_READER_PROVIDER: z.enum(pageReaderProviderIds).default('spider'),
  SPIDER_API_KEY: optionalText,
  // Another Spider scrape endpoint (a self-hosted or stand-in one); its API by default.
  SPIDER_API_URL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    httpUrl.optional(),
  ),
  // Pages one website reads at most; later per plan.
  MAX_WEBSITE_PAGES: z.coerce.number().int().positive().default(500),
  // Who answers typed judgments (page cleanup, website scope).
  DECISION_PROVIDER: z.enum(decisionProviderIds).default('openai'),
  TYPESAFE_API_KEY: optionalText,
  // Another TypeSafe endpoint (a regional or self-hosted one); its API by default.
  TYPESAFE_API_URL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    httpUrl.optional(),
  ),
  // Team chat apps (docs/teamChat.md). Each app is offered only when all of
  // its variables are set; otherwise its card says "Not available yet".
  SLACK_CLIENT_ID: z.string().min(1).optional(),
  SLACK_CLIENT_SECRET: z.string().min(1).optional(),
  SLACK_SIGNING_SECRET: z.string().min(1).optional(),
  // Customer WhatsApp (docs/customerWhatsapp.md): our Meta app's secret
  // signs its webhooks, and the verify token answers Meta's webhook check.
  // Without both, the WhatsApp Business card says "Not available yet".
  WHATSAPP_APP_SECRET: z.string().min(1).optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().min(1).optional(),
})

const result = envSchema
  .superRefine((value, context) => {
    const selected = [
      llmProviderVendors[value.LLM_PROVIDER],
      decisionProviderVendors[value.DECISION_PROVIDER],
      pageReaderProviderVendors[value.PAGE_READER_PROVIDER],
    ]
    for (const name of new Set(selected.map((vendor) => vendorKeys[vendor])))
      if (!value[name])
        context.addIssue({
          code: 'custom',
          path: [name],
          message: 'Required by a selected provider',
        })
  })
  .safeParse({
    ...process.env,
    // Keep existing installations working during the frontend URL rename.
    FRONT_END_URL: process.env.FRONT_END_URL ?? process.env.WEB_URL,
  })

if (!result.success) {
  const names = [...new Set(result.error.issues.map((issue) => issue.path[0]))]
  throw new Error(`Invalid environment configuration: ${names.join(', ')}`)
}

export const env = result.data

/** A vendor's API key (checked at startup for the selected providers). */
export const vendorKey = (vendor: tVendor) => env[vendorKeys[vendor]]
