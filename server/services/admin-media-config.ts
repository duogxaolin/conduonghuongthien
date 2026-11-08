/**
 * The media configuration the admin Media Portal routes resolve before they hand work to a
 * service — `upload/init`, `upload/:id/chunk`, `upload/:id/complete`, `upload/housekeep`,
 * `:id/process`, `:id/thumbnail` (POST / DELETE) and `config.get` — and the category labels
 * `config.get` lists, moved out of the handlers verbatim.
 *
 * Imports the shared handle (`getDb`) and nothing more from the database layer, and nothing from
 * the `media-portal` barrel: tests/audit-access-control.test.ts loads `config.get.ts` with the
 * database layer faked as `getDb` alone and the barrel faked with two names.
 */
import { asc } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { mediaCategories } from '../db/schema'
import { resolveMediaConfigWithDb } from './media-config-service'

/** The effective media config (database > environment > default), read through the shared handle. */
export async function resolveAdminMediaConfig() {
  return resolveMediaConfigWithDb(getDb())
}

/** `id` and `name` of every Media Portal category, in the order the media forms list them. */
export async function listMediaCategoryOptions() {
  const db = getDb()
  const options = await db.select({ id: mediaCategories.id, name: mediaCategories.name })
    .from(mediaCategories).orderBy(asc(mediaCategories.displayOrder), asc(mediaCategories.name), asc(mediaCategories.id))
  return options
}
