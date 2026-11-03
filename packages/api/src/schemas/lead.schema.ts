import { z } from 'zod'
import { leadStatuses } from '../db/schema/product/lead'
import { leadContactRoles } from '../db/schema/product/leadContact'

export const updateLeadSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    summary: z.string().max(5000).nullable().optional(),
    status: z.enum(leadStatuses).optional(),
    // Minor units (cents).
    value: z.number().int().min(0).max(1_000_000_000_00).nullable().optional(),
    assignedMemberId: z.string().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0)

export const addNoteSchema = z.object({
  body: z.string().trim().min(1).max(5000),
})
export const mergeLeadSchema = z.object({ targetLeadId: z.uuid() })

// The requester is the lead's own contact; others join with another role.
const addedRole = z.enum(leadContactRoles).exclude(['requester'])

export const addLeadContactSchema = z.object({
  contactId: z.string().min(1),
  role: addedRole,
})
export const updateLeadContactSchema = z.object({ role: addedRole })
