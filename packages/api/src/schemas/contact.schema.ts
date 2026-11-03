import { z } from 'zod'
import { contactIdentityKinds } from '../db/schema/product/contactIdentity'

export const updateContactSchema = z
  .object({
    name: z.string().trim().max(200).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0)

export const addIdentitySchema = z.object({
  kind: z.enum(contactIdentityKinds),
  value: z.string().trim().min(1).max(320),
})

export const mergeContactSchema = z.object({
  sourceContactId: z.string().min(1),
})

export const contactFactSchema = z.object({
  text: z.string().trim().min(1).max(500),
})

// A contact added by hand: at least one way to reach them.
export const createContactSchema = z
  .object({
    name: z.string().trim().max(200).nullable().optional(),
    email: z.string().trim().max(320).nullable().optional(),
    phone: z.string().trim().max(40).nullable().optional(),
  })
  .refine((value) => Boolean(value.email || value.phone), {
    message: 'Email or phone is required',
  })
