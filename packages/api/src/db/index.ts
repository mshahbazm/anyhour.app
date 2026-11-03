import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { env } from '../env'
import * as schema from './schema'

// Drizzle's timestamp columns store UTC without an offset. Database defaults
// must use the same clock representation as explicit application timestamps.
const pool = new Pool({
  connectionString: env.DATABASE_URL,
  options: '-c timezone=UTC',
})

export const db = drizzle({ client: pool, schema })
