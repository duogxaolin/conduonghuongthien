import { getDb } from '../../../utils/db'
import { categories } from '../../../db/schema'
import { uniqueCategorySlug } from '../../../utils/slug'
import { eq } from 'drizzle-orm'
import { requireResourcePermission } from '../../../utils/permissions'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'categories', 'update')

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid category ID' })

  const db = getDb()
  const [existing] = await db.select().from(categories).where(eq(categories.id, id)).limit(1)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Danh mục không tồn tại.' })
  }

  const body = await readBody(event).catch(() => ({}))
  const updateFields: any = {}

  if (body.name !== undefined) updateFields.name = String(body.name).trim()
  if (body.type !== undefined) updateFields.type = String(body.type).trim()
  if (body.description !== undefined) updateFields.description = String(body.description).trim() || null
  if (body.displayOrder !== undefined) updateFields.displayOrder = Number(body.displayOrder)

  // Slug: regenerate/validate on name or slug change, excluding the current row from collision check
  if (body.slug !== undefined || body.name !== undefined) {
    const rawSlug = body.slug !== undefined ? String(body.slug).trim() : ''
    const base = rawSlug || updateFields.name || existing.name
    updateFields.slug = await uniqueCategorySlug(db, base, id)
  }

  // parentId update
  if ('parentId' in body) {
    const parentId = body.parentId ? Number(body.parentId) : null
    if (parentId) {
      if (parentId === id) {
        throw createError({ statusCode: 400, statusMessage: 'Không thể đặt danh mục làm cha của chính nó.' })
      }
      const [parent] = await db.select().from(categories).where(eq(categories.id, parentId)).limit(1)
      if (!parent) {
        throw createError({ statusCode: 400, statusMessage: 'Danh mục cha không tồn tại.' })
      }
      if (parent.parentId !== null) {
        throw createError({ statusCode: 400, statusMessage: 'Chỉ cho phép 1 cấp cha-con.' })
      }
      // Cannot set parent if this category itself has children
      const children = await db.select({ id: categories.id }).from(categories).where(eq(categories.parentId, id)).limit(1)
      if (children.length > 0) {
        throw createError({ statusCode: 400, statusMessage: 'Không thể đặt danh mục cha cho danh mục đã có con.' })
      }
    }
    updateFields.parentId = parentId
  }

  if (Object.keys(updateFields).length === 0) {
    return { ok: true }
  }

  await db.update(categories).set(updateFields).where(eq(categories.id, id))
  return { ok: true, slug: updateFields.slug ?? existing.slug }
})
