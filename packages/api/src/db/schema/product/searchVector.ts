import { customType } from 'drizzle-orm/pg-core'

// Postgres full-text search vector: keyword matching beside vector search, so
// exact terms (a product name, a price, a plan) are found even when their
// embedding isn't the closest.
export const searchVector = customType<{ data: string }>({
  dataType: () => 'tsvector',
})

// English stemming and stop words; other languages still match their exact
// words, since documents and questions are processed the same way.
export const searchLanguage = 'english'
