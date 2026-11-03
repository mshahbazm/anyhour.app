import { sql } from 'drizzle-orm'

// Test rows for an employee's own sources name their workspace too; this
// reads it from the employee so direct inserts stay one line.
export const orgOf = (assistantId: string) =>
  sql<string>`(select organization_id from assistant where id = ${assistantId})`
