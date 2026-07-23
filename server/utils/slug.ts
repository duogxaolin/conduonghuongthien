import type { getDb } from './db'
import { categories, contentTypes, pages } from '../db/schema'
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

/**
 * Resolve a collision-safe content-type slug. Content-type slugs are the `type`
 * key referenced by categories/articles, so they use `_` instead of `-` between
 * words to stay consistent with the built-in system slugs (role_model, etc.).
 * `excludeId` skips the current row when editing.
 */
export async function uniqueContentTypeSlug(db: Db, base: string, excludeId?: number): Promise<string> {
  const baseSlug = (slugify(base) || 'the-loai').replace(/-/g, '_')

  const rows = await db
    .select({ id: contentTypes.id, slug: contentTypes.slug })
    .from(contentTypes)
    .where(
      excludeId
        ? and(like(contentTypes.slug, `${baseSlug}%`), ne(contentTypes.id, excludeId))
        : like(contentTypes.slug, `${baseSlug}%`),
    )

  const taken = new Set(rows.map((r) => r.slug))
  if (!taken.has(baseSlug)) return baseSlug

  let n = 2
  while (taken.has(`${baseSlug}_${n}`)) n++
  return `${baseSlug}_${n}`
}

/**
 * Resolve a collision-safe page slug by appending the smallest free
 * `-2`, `-3`, … suffix. `excludeId` skips the current row when editing.
 */
export async function uniquePageSlug(db: Db, base: string, excludeId?: number): Promise<string> {
  const baseSlug = slugify(base) || 'trang'

  const rows = await db
    .select({ id: pages.id, slug: pages.slug })
    .from(pages)
    .where(
      excludeId
        ? and(like(pages.slug, `${baseSlug}%`), ne(pages.id, excludeId))
        : like(pages.slug, `${baseSlug}%`),
    )

  const taken = new Set(rows.map((r) => r.slug))
  if (!taken.has(baseSlug)) return baseSlug

  let n = 2
  while (taken.has(`${baseSlug}-${n}`)) n++
  return `${baseSlug}-${n}`
}
