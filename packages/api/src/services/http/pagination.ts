import { and, eq, sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core'
import type { Context } from 'hono'
import { db } from '../../db'
import { ApiError } from './apiError'

export async function readPage(
  c: Context,
  table: PgTable,
  id: AnyPgColumn,
  timestamp: AnyPgColumn,
  scope: SQL,
) {
  const limit = Number(c.req.query('limit') ?? '100')
  if (!Number.isInteger(limit) || limit < 1 || limit > 200)
    throw new ApiError(422, 'invalid_limit', 'Limit must be between 1 and 200')
  const cursor = c.req.query('cursor')
  if (cursor !== undefined) {
    const [record] = await db
      .select({ id })
      .from(table)
      .where(and(scope, eq(id, cursor)))
      .limit(1)
    if (!record) throw new ApiError(422, 'invalid_cursor', 'Cursor is invalid')
  }
  // Keep timestamp comparison in PostgreSQL, preserving microsecond precision.
  const before =
    cursor === undefined
      ? undefined
      : sql`(${timestamp}, ${id}) < (
    select ${timestamp}, ${id} from ${table} where ${and(scope, eq(id, cursor))}
  )`
  return { limit, where: and(scope, before) }
}

export function pageResponse<T extends { id: string }>(
  c: Context,
  rows: T[],
  limit: number,
) {
  if (rows.length > limit) {
    c.header('X-Next-Cursor', rows[limit - 1].id)
    c.header('Access-Control-Expose-Headers', 'X-Next-Cursor')
  }
  return c.json(rows.slice(0, limit))
}
