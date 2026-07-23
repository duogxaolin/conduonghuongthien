import { getDb } from '../../../utils/db'
import { categories } from '../../../db/schema'
import { checkPermission } from '../../../utils/auth'
import { eq } from 'drizzle-orm'

function slugify(text: string): string {
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
}

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  if (!checkPermission(adminUser.permissions, 'news', 'update', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }

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

  // Slug update
  if (body.slug !== undefined) {
    const rawSlug = String(body.slug).trim()
    updateFields.slug = rawSlug ? slugify(rawSlug) : slugify(updateFields.name || existing.name)
  }

  // parentId update
  if ('parentId' in body) {
    const parentId = body.parentId ? Number(body.parentId) : null
    if (parentId) {
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
  return { ok: true }
})
