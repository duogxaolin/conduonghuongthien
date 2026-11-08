/**
 * Plain reads of the `settings` table for the admin settings endpoints, moved out of the
 * handlers verbatim. Which keys are read — and why those keys — is decided in the handler that
 * calls these; this file only runs the query. It imports nothing but the query builder, so a
 * test that fakes the DB layer (or all of h3) for one of those endpoints still loads it.
 */
import { inArray } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { settings } from '../db/schema'

/** Every row of `settings`, every column (`GET` / `PUT /api/admin/settings/backup`). */
export async function readAllSettingRows() {
  const db = getDb()
  const rows = await db.select().from(settings)
  return rows
}

/** `key` and `value` of every row of `settings` (`PUT /api/admin/settings`). */
export async function readAllSettingValues() {
  const db = getDb()
  const rows = await db.select({ key: settings.key, value: settings.value }).from(settings)
  return rows
}

/** `key` and `value` of the stored rows among `keys`. */
export async function readSettingValues(keys: string[]) {
  const db = getDb()
  const rows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(inArray(settings.key, keys))
  return rows
}
