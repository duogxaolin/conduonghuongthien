import type { Config } from 'drizzle-kit'

/**
 * Drizzle Kit configuration.
 *
 * Source of truth
 * ---------------
 * `server/db/schema.ts` is the canonical description of the database. Two other
 * artefacts exist and must stay in agreement with it:
 *
 *   1. `server/db/init.ts` — the runtime bootstrap that creates/converges tables
 *      on start (it also carries data-preserving column migrations). It remains
 *      the mechanism that actually runs in production.
 *   2. `migrations/*.sql`  — historical mysqldump snapshots. They are NOT a
 *      migration chain and must never be replayed against a live database
 *      (see the guard header inside those files).
 *
 * Use `npm run db:drift` to verify schema.ts and init.ts still describe the same
 * tables, and `npm run db:generate` to produce a reviewable SQL diff when the
 * schema changes. Generated files land in `drizzle/` and are applied manually
 * after review — nothing here auto-mutates a production database.
 */
export default {
  schema: './server/db/schema.ts',
  out: './drizzle',
  dialect: 'mysql',
  dbCredentials: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'cdkt_admin',
  },
  // Never let tooling drop objects it does not know about.
  strict: true,
  verbose: true,
} satisfies Config
