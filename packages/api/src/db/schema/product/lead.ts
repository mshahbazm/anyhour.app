import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import { member } from '../auth/member'
import { organization } from '../auth/organization'
import { assistant } from './assistant'
import { contact } from './contact'

// What the lead wants, judged by the qualification pass at capture.
export const leadIntents = ['buy', 'enquire', 'support', 'spam'] as const
export type tLeadIntent = (typeof leadIntents)[number]

// Where a lead stands. new and contacted are open; won and lost are closed
// and set closedAt.
export const leadStatuses = ['new', 'contacted', 'won', 'lost'] as const
export type tLeadStatus = (typeof leadStatuses)[number]
export const openLeadStatuses: readonly tLeadStatus[] = ['new', 'contacted']
export const closedLeadStatuses: readonly tLeadStatus[] = ['won', 'lost']

// The qualification pass's judgement against the workspace's ideal customer
// profile. Reasoning is kept so the timeline can show why.
export interface iLeadQualification {
  fit: 'strong' | 'possible' | 'poor'
  urgency: 'now' | 'soon' | 'later'
  summary: string
  reasoning: string
  model: string
  // ISO time of the pass.
  at: string
}

export const lead = pgTable(
  'lead',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id),
    assistantId: text('assistant_id')
      .notNull()
      .references(() => assistant.id),
    contactId: text('contact_id')
      .notNull()
      .references(() => contact.id),
    title: text('title').notNull(),
    summary: text('summary'),
    status: text('status', { enum: leadStatuses }).notNull().default('new'),
    statusChangedAt: timestamp('status_changed_at'),
    // What the work is worth, in minor units (cents); set when won. There is
    // no workspace currency yet, so it is shown as a plain amount.
    value: integer('value'),
    capturedVia: text('captured_via', {
      enum: ['chat', 'manual'],
    }).notNull(),
    // enquiry: wants to buy/book; question: the bot couldn't answer and a person should reply.
    reason: text('reason', { enum: ['enquiry', 'question'] })
      .notNull()
      .default('enquiry'),
    intent: text('intent', { enum: leadIntents }),
    // 0–100, from the qualification pass.
    score: integer('score'),
    qualification: jsonb('qualification').$type<iLeadQualification>(),
    assignedMemberId: text('assigned_member_id').references(() => member.id, {
      onDelete: 'set null',
    }),
    mergedIntoLeadId: text('merged_into_lead_id').references(
      (): AnyPgColumn => lead.id,
    ),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    closedAt: timestamp('closed_at'),
  },
  (table) => [
    index('lead_org_created_id_idx').on(
      table.organizationId,
      table.createdAt,
      table.id,
    ),
    index('lead_organization_created_idx').on(
      table.organizationId,
      table.createdAt,
    ),
    index('lead_contact_idx').on(table.contactId),
    index('lead_organization_status_idx').on(
      table.organizationId,
      table.status,
    ),
  ],
)
