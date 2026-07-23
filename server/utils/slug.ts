import type { getDb } from './db'
import { categories } from '../db/schema'
import { ne, and, like } from 'drizzle-orm'

type Db = ReturnType<typeof getDb>

/** Slugify Vietnamese/Unicode text into a clean ascii-safe slug. No timestamps. */
export function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .replace(/([^0-9a-z-\s])/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Resolve a collision-safe category slug by appending the smallest free
 * `-2`, `-3`, … suffix. `excludeId` skips the current row when editing.
 */
export async function uniqueCategorySlug(db: Db, base: string, excludeId?: number): Promise<string> {
  const baseSlug = slugify(base) || 'muc'

  // Pull existing slugs that could collide (baseSlug or baseSlug-N)
  const rows = await db
    .select({ id: categories.id, slug: categories.slug })
    .from(categories)
    .where(
      excludeId
        ? and(like(categories.slug, `${baseSlug}%`), ne(categories.id, excludeId))
        : like(categories.slug, `${baseSlug}%`),
    )

  const taken = new Set(rows.map((r) => r.slug))
  if (!taken.has(baseSlug)) return baseSlug

  let n = 2
  while (taken.has(`${baseSlug}-${n}`)) n++
  return `${baseSlug}-${n}`
}
