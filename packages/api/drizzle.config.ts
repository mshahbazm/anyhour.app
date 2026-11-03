import { defineConfig } from 'drizzle-kit'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required for Drizzle Kit')

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './migrations',
  casing: 'snake_case',
  dbCredentials: { url: databaseUrl },
})
