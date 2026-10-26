import type { getDb } from './db'
import { categories, contentTypes, mediaCategories, pages } from '../db/schema'
import { ne, and, like } from 'drizzle-orm'
import { slugify } from '../../shared/slugify'

type Db = ReturnType<typeof getDb>

// The pure rule lives in `shared/slugify.ts` (the admin pages run the same one);
// only the DB-backed `unique*Slug()` helpers stay server-side.
export { slugify }

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
 * Resolve a collision-safe **media category** slug (bảng `media_categories`,
 * tách khỏi `categories` bài viết). Cùng khuôn `uniqueCategorySlug` nhưng trỏ
 * bảng khác.
 */
export async function uniqueMediaCategorySlug(db: Db, base: string, excludeId?: number): Promise<string> {
  const baseSlug = slugify(base) || 'danh-muc-video'

  const rows = await db
    .select({ id: mediaCategories.id, slug: mediaCategories.slug })
    .from(mediaCategories)
    .where(
      excludeId
        ? and(like(mediaCategories.slug, `${baseSlug}%`), ne(mediaCategories.id, excludeId))
        : like(mediaCategories.slug, `${baseSlug}%`),
    )

  const taken = new Set(rows.map((r) => r.slug))
  if (!taken.has(baseSlug)) return baseSlug

  let n = 2
  while (taken.has(`${baseSlug}-${n}`)) n++
  return `${baseSlug}-${n}`
}

/**
 * Resolve a collision-safe content-type slug.
 *
 * - **System** types (`isSystem: true`) dùng `_` để khớp seed built-in
 *   (`role_model`, `reintegration_model`) — không đổi, vì các route tĩnh
 *   (`/role-models`, `/reintegration-models`) + query `type=` đã cọc vào.
 * - **Custom** types (`isSystem: false`, mặc định) dùng `-` (gạch ngang chuẩn,
 *   giống category) để nhất quán với URL công khai (`/video-tuyen-truyen`).
 *
 * `excludeId` skips the current row when editing.
 */
export async function uniqueContentTypeSlug(db: Db, base: string, excludeId?: number, isSystem = false): Promise<string> {
  const baseSlug = slugify(base) || (isSystem ? 'the_loai' : 'the-loai')
  // System seed dùng `_`; custom giữ `-` như slugify trả về.
  const normalized = isSystem ? baseSlug.replace(/-/g, '_') : baseSlug

  const rows = await db
    .select({ id: contentTypes.id, slug: contentTypes.slug })
    .from(contentTypes)
    .where(
      excludeId
        ? and(like(contentTypes.slug, `${normalized}%`), ne(contentTypes.id, excludeId))
        : like(contentTypes.slug, `${normalized}%`),
    )

  const taken = new Set(rows.map((r) => r.slug))
  if (!taken.has(normalized)) return normalized

  const sep = isSystem ? '_' : '-'
  let n = 2
  while (taken.has(`${normalized}${sep}${n}`)) n++
  return `${normalized}${sep}${n}`
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
