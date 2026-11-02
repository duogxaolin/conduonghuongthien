/**
 * Creating and editing an article category (`POST /api/admin/categories`,
 * `PUT /api/admin/categories/:id`) — moved out of the two routes so the duplicate-name check
 * and the write it guards run in ONE transaction.
 *
 * Two categories with the same name in the same place used to be accepted: the slug was the
 * only thing compared, and `uniqueCategorySlug` quietly made the second one `-2`, so the
 * officer saw two "Tin nổi bật" side by side and could not tell them apart in any select.
 *
 * "The same place" (`siblingScope`): the same parent for a child — any content type, the
 * parent decides; for a root (no parent), the roots of the same content type. Roots of two
 * types are listed apart everywhere (the categories page groups by type, the editor shows
 * one type's categories), so "Văn bản" may be a root of both "Văn bản pháp luật" and "Hỏi đáp".
 * "The same name" (`categoryNameKey`): case, Vietnamese accents, `đ`/`Đ` and runs of spaces
 * ignored; punctuation kept ("Tin & Sự kiện" is not "Tin Sự kiện").
 *
 * Concurrency: the check reads without a lock (the lock shape of these writes is unchanged —
 * none). Two creates of the same name sent at the same instant usually still collide: both
 * derive the same slug and the second insert hits the unique key on `slug`; that error retries
 * the whole transaction (`withSlugRaceRetry`), whose check then sees the first one and answers
 * 409. What still gets through is two such writes with DIFFERENT explicit slugs in the same
 * instant — closing that needs a unique index on (scope, normalised name), i.e. a migration:
 * KNOWN, not done here (docs/CHANGELOG.md § 70).
 *
 * No `activity_logs` row: neither route wrote one before, and this change adds none.
 * Tests: tests/category-writes-behavior.test.ts (the routes, the service, the SQL it sends).
 */
import { createError } from 'h3'
import { and, eq, isNull, ne, type SQL } from 'drizzle-orm'

import { categories } from '../db/schema'
import { getDb } from '../utils/db'
import { isDuplicateEntry } from '../utils/mysql-errors'
import { requireResourcePermission, type ActorLike } from '../utils/permissions'
import { uniqueCategorySlug } from '../utils/slug'

type Db = ReturnType<typeof getDb>
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

export const DUPLICATE_CATEGORY_MESSAGE = 'Đã có danh mục cùng tên trong mục này'

/** The key two names are "the same" under: case, accents, `đ`/`Đ`, spacing ignored. */
export function categoryNameKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Where a category's name must be unique: its parent's children, or its type's roots. */
export function siblingScope(place: { parentId: number | null, type: string }): SQL {
  return place.parentId != null
    ? eq(categories.parentId, place.parentId)
    : and(isNull(categories.parentId), eq(categories.type, place.type))!
}

async function assertNameFree(tx: Tx, place: { name: string, parentId: number | null, type: string }, excludeId?: number) {
  const scope = siblingScope(place)
  const siblings = await tx
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(excludeId ? and(scope, ne(categories.id, excludeId)) : scope)
  const key = categoryNameKey(place.name)
  const same = siblings.find(row => categoryNameKey(row.name) === key)
  if (same) {
    throw createError({ statusCode: 409, statusMessage: `${DUPLICATE_CATEGORY_MESSAGE}: “${same.name}”.` })
  }
}

/** The parent must exist and be a root (one level only) — the routes' own sentences, unchanged. */
async function assertParentUsable(tx: Tx, parentId: number, oneLevelMessage: string) {
  const [parent] = await tx.select({ id: categories.id, parentId: categories.parentId }).from(categories).where(eq(categories.id, parentId)).limit(1)
  if (!parent) throw createError({ statusCode: 400, statusMessage: 'Danh mục cha không tồn tại.' })
  if (parent.parentId !== null) throw createError({ statusCode: 400, statusMessage: oneLevelMessage })
}

/** A unique-key error (the slug, taken meanwhile) runs the whole transaction again — at most twice. */
async function withSlugRaceRetry<T>(write: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await write()
    } catch (err: unknown) {
      if (attempt >= 3 || !isDuplicateEntry(err)) throw err
    }
  }
}

export interface CategoryCreateInput {
  name: string
  /** As typed; empty → derived from the name. */
  rawSlug: string
  type: string
  description: string | null
  displayOrder: number
  parentId: number | null
}

export async function createCategory(actor: ActorLike, input: CategoryCreateInput): Promise<{ id: number, slug: string }> {
  requireResourcePermission(actor, 'categories', 'create')
  if (!input.name) throw createError({ statusCode: 400, statusMessage: 'Tên danh mục không được để trống.' })
  if (!input.type) throw createError({ statusCode: 400, statusMessage: 'Loại danh mục không được để trống.' })

  const db = getDb()
  return withSlugRaceRetry(() => db.transaction(async (tx) => {
    if (input.parentId) await assertParentUsable(tx, input.parentId, 'Chỉ cho phép 1 cấp cha-con. Không thể chọn danh mục con làm cha.')
    await assertNameFree(tx, { name: input.name, parentId: input.parentId, type: input.type })

    // Clean, collision-safe slug: derived from provided slug or name, deduped by -2, -3, …
    const slug = await uniqueCategorySlug(tx, input.rawSlug || input.name)
    const [res] = await tx.insert(categories).values({
      name: input.name,
      slug,
      parentId: input.parentId,
      type: input.type,
      description: input.description,
      displayOrder: input.displayOrder,
    })
    return { id: Number(res.insertId), slug }
  }))
}

/** Only the keys the request sent (`undefined` = not sent); `parentId` sent as `null` means "make it a root". */
export interface CategoryUpdateInput {
  name?: string
  /** Sent (even empty): regenerate the slug from it, or from the name when empty. */
  rawSlug?: string
  type?: string
  description?: string | null
  displayOrder?: number
  parentId?: number | null
}

export type CategoryUpdateResult =
  | { written: false }
  | { written: true, slug: string, name: string, description: string | null, textChanged: boolean }

export async function updateCategory(actor: ActorLike, id: number, input: CategoryUpdateInput): Promise<CategoryUpdateResult> {
  requireResourcePermission(actor, 'categories', 'update')
  const db = getDb()
  return withSlugRaceRetry(() => db.transaction(async (tx): Promise<CategoryUpdateResult> => {
    const [existing] = await tx.select().from(categories).where(eq(categories.id, id)).limit(1)
    if (!existing) throw createError({ statusCode: 404, statusMessage: 'Danh mục không tồn tại.' })

    const fields: Partial<typeof categories.$inferInsert> = {}
    if (input.name !== undefined) {
      if (!input.name) throw createError({ statusCode: 400, statusMessage: 'Tên danh mục không được để trống.' })
      fields.name = input.name
    }
    if (input.type !== undefined) fields.type = input.type
    if (input.description !== undefined) fields.description = input.description
    if (input.displayOrder !== undefined) fields.displayOrder = input.displayOrder

    // Slug: regenerate/validate on name or slug change, excluding the current row from collision check
    if (input.rawSlug !== undefined || input.name !== undefined) {
      fields.slug = await uniqueCategorySlug(tx, input.rawSlug || fields.name || existing.name, id)
    }

    if (input.parentId !== undefined) {
      const parentId = input.parentId
      if (parentId) {
        if (parentId === id) throw createError({ statusCode: 400, statusMessage: 'Không thể đặt danh mục làm cha của chính nó.' })
        await assertParentUsable(tx, parentId, 'Chỉ cho phép 1 cấp cha-con.')
        // Cannot set parent if this category itself has children
        const children = await tx.select({ id: categories.id }).from(categories).where(eq(categories.parentId, id)).limit(1)
        if (children.length > 0) throw createError({ statusCode: 400, statusMessage: 'Không thể đặt danh mục cha cho danh mục đã có con.' })
      }
      fields.parentId = parentId
    }

    if (Object.keys(fields).length === 0) return { written: false }

    // Renamed, moved under another parent, or moved to another type: the name it will have
    // must be free where it will be — itself excluded, so changing only the case of its own
    // name passes.
    if (input.name !== undefined || input.type !== undefined || input.parentId !== undefined) {
      await assertNameFree(tx, {
        name: fields.name ?? existing.name,
        parentId: fields.parentId !== undefined ? fields.parentId : existing.parentId,
        type: fields.type ?? existing.type,
      }, id)
    }

    await tx.update(categories).set(fields).where(eq(categories.id, id))
    return {
      written: true,
      slug: fields.slug ?? existing.slug,
      name: fields.name ?? existing.name,
      description: fields.description !== undefined ? (fields.description ?? null) : existing.description,
      textChanged: fields.name !== undefined || fields.description !== undefined,
    }
  }))
}
