import { Hono } from 'hono'
import { db } from '../db'
import { contact } from '../db/schema'
import {
  addIdentitySchema,
  contactFactSchema,
  createContactSchema,
  mergeContactSchema,
  updateContactSchema,
} from '../schemas/contact.schema'
import { draftTextSchema } from '../schemas/draft.schema'
import { requirePermission } from '../services/auth/authorize'
import { createContact } from '../services/contacts/create'
import { draftContactFromText } from '../services/contacts/drafts'
import {
  contactDetail,
  contactScope,
  listContacts,
  updateContact,
} from '../services/contacts/contacts'
import {
  addFact,
  deleteFact,
  listFacts,
  updateFact,
} from '../services/contacts/facts'
import { addIdentity, removeIdentity } from '../services/contacts/identities'
import { mergeContacts } from '../services/contacts/merge'
import { pageResponse, readPage } from '../services/http/pagination'
import { validateJson } from '../services/http/validateJson'

export const contactRoutes = new Hono()

contactRoutes.get('/:organizationId/contacts', async (c) => {
  const organizationId = c.req.param('organizationId')
  await requirePermission(c.req.raw.headers, organizationId, 'contact', 'read')
  const page = await readPage(
    c,
    contact,
    contact.id,
    contact.createdAt,
    contactScope(organizationId, { q: c.req.query('q') }),
  )
  return pageResponse(
    c,
    await listContacts(page.where!, page.limit + 1),
    page.limit,
  )
})

contactRoutes.post(
  '/:organizationId/contacts',
  validateJson(createContactSchema),
  async (c) => {
    const organizationId = c.req.param('organizationId')
    await requirePermission(
      c.req.raw.headers,
      organizationId,
      'contact',
      'update',
    )
    return c.json(await createContact(organizationId, c.req.valid('json')), 201)
  },
)

// A contact drafted from the owner's words, for them to check; saves nothing.
contactRoutes.post(
  '/:organizationId/contacts/drafts',
  validateJson(draftTextSchema),
  async (c) => {
    const organizationId = c.req.param('organizationId')
    await requirePermission(
      c.req.raw.headers,
      organizationId,
      'contact',
      'update',
    )
    return c.json(
      await draftContactFromText(organizationId, c.req.valid('json').text),
    )
  },
)

contactRoutes.get('/:organizationId/contacts/:contactId', async (c) => {
  const { organizationId, contactId } = c.req.param()
  await requirePermission(c.req.raw.headers, organizationId, 'contact', 'read')
  return c.json(await contactDetail(db, organizationId, contactId))
})

contactRoutes.patch(
  '/:organizationId/contacts/:contactId',
  validateJson(updateContactSchema),
  async (c) => {
    const { organizationId, contactId } = c.req.param()
    await requirePermission(
      c.req.raw.headers,
      organizationId,
      'contact',
      'update',
    )
    return c.json(
      await updateContact(organizationId, contactId, c.req.valid('json')),
    )
  },
)

contactRoutes.post(
  '/:organizationId/contacts/:contactId/identities',
  validateJson(addIdentitySchema),
  async (c) => {
    const { organizationId, contactId } = c.req.param()
    await requirePermission(
      c.req.raw.headers,
      organizationId,
      'contact',
      'update',
    )
    const { identity, created } = await addIdentity(
      organizationId,
      contactId,
      c.req.valid('json'),
    )
    return c.json(identity, created ? 201 : 200)
  },
)

contactRoutes.delete(
  '/:organizationId/contacts/:contactId/identities/:identityId',
  async (c) => {
    const { organizationId, contactId, identityId } = c.req.param()
    await requirePermission(
      c.req.raw.headers,
      organizationId,
      'contact',
      'update',
    )
    await removeIdentity(organizationId, contactId, identityId)
    return c.body(null, 204)
  },
)

contactRoutes.post(
  '/:organizationId/contacts/:contactId/merge',
  validateJson(mergeContactSchema),
  async (c) => {
    const { organizationId, contactId } = c.req.param()
    const { membership } = await requirePermission(
      c.req.raw.headers,
      organizationId,
      'contact',
      'update',
    )
    return c.json(
      await mergeContacts(
        organizationId,
        contactId,
        c.req.valid('json').sourceContactId,
        membership.id,
      ),
    )
  },
)

contactRoutes.get('/:organizationId/contacts/:contactId/facts', async (c) => {
  const { organizationId, contactId } = c.req.param()
  await requirePermission(c.req.raw.headers, organizationId, 'contact', 'read')
  return c.json(await listFacts(organizationId, contactId))
})

contactRoutes.post(
  '/:organizationId/contacts/:contactId/facts',
  validateJson(contactFactSchema),
  async (c) => {
    const { organizationId, contactId } = c.req.param()
    const { membership } = await requirePermission(
      c.req.raw.headers,
      organizationId,
      'contact',
      'update',
    )
    return c.json(
      await addFact(
        organizationId,
        contactId,
        c.req.valid('json').text,
        membership.id,
      ),
      201,
    )
  },
)

contactRoutes.patch(
  '/:organizationId/contacts/:contactId/facts/:factId',
  validateJson(contactFactSchema),
  async (c) => {
    const { organizationId, contactId, factId } = c.req.param()
    await requirePermission(
      c.req.raw.headers,
      organizationId,
      'contact',
      'update',
    )
    return c.json(
      await updateFact(
        organizationId,
        contactId,
        factId,
        c.req.valid('json').text,
      ),
    )
  },
)

contactRoutes.delete(
  '/:organizationId/contacts/:contactId/facts/:factId',
  async (c) => {
    const { organizationId, contactId, factId } = c.req.param()
    await requirePermission(
      c.req.raw.headers,
      organizationId,
      'contact',
      'update',
    )
    await deleteFact(organizationId, contactId, factId)
    return c.body(null, 204)
  },
)
