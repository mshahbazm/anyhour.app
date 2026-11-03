import { Resend } from 'resend'
import { env } from '../../env'

// Plain-text email from the platform sender (EMAIL_FROM) through Resend.

export class EmailSendError extends Error {
  constructor(
    message: string,
    public retryable: boolean,
  ) {
    super(message)
    this.name = 'EmailSendError'
  }
}

let client: Resend | undefined

// Resend errors that the same request will hit again: bad input, a bad or
// restricted key, an unverified sender. Anything else (rate limits, quotas,
// server errors) may pass later.
const permanentErrors = new Set([
  'validation_error',
  'missing_required_field',
  'invalid_parameter',
  'invalid_from_address',
  'invalid_to_address',
  'invalid_attachment',
  'invalid_region',
  'invalid_idempotency_key',
  'invalid_idempotent_request',
  'missing_api_key',
  'invalid_api_key',
  'restricted_api_key',
  'invalid_access',
  'security_error',
  'not_found',
  'method_not_allowed',
])

const subjectChars = 300

// Subjects and addresses come partly from visitors (a contact's name, a lead's
// title): one line, no control characters, so nothing can become a header.
export function headerSafe(value: string, limit = subjectChars) {
  return value
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit)
}

// One plain address: anything that could name a second recipient or break
// the header is refused before it reaches the email service.
function singleAddress(value: string) {
  return /^[^\s@,;:<>"()[\]\\]+@[^\s@,;:<>"()[\]\\]+$/.test(value)
}

export async function sendEmail(input: {
  to: string
  subject: string
  text: string
  replyTo?: string | null
  // The same key within a day sends once, so a retried step can't send twice.
  idempotencyKey?: string
  // Files to attach, such as a post's image to download.
  attachments?: Array<{ filename: string; content: Buffer }>
}): Promise<{ messageId: string | null }> {
  if (!singleAddress(input.to))
    throw new EmailSendError('The email address is not valid', false)
  const replyTo =
    input.replyTo && singleAddress(input.replyTo) ? input.replyTo : null
  client ??= new Resend(env.RESEND_API_KEY)
  let result: Awaited<ReturnType<Resend['emails']['send']>>
  try {
    result = await client.emails.send(
      {
        from: env.EMAIL_FROM,
        to: [input.to],
        subject: headerSafe(input.subject),
        text: input.text,
        ...(replyTo ? { replyTo } : {}),
        ...(input.attachments?.length
          ? { attachments: input.attachments }
          : {}),
      },
      input.idempotencyKey
        ? { idempotencyKey: input.idempotencyKey.slice(0, 256) }
        : undefined,
    )
  } catch {
    throw new EmailSendError('The email service could not be reached', true)
  }
  if (result.error) {
    const name = String(result.error.name ?? '')
    const permanent = permanentErrors.has(name)
    throw new EmailSendError(
      permanent
        ? `The email service refused it (${name})`
        : `The email service is unavailable (${name || 'unknown error'})`,
      !permanent,
    )
  }
  return { messageId: result.data?.id ?? null }
}
