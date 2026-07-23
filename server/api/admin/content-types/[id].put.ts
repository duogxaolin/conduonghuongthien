import { getDb } from '../../../utils/db'
import { contentTypes, categories, articles } from '../../../db/schema'
import { checkPermission } from '../../../utils/auth'
import { uniqueContentTypeSlug } from '../../../utils/slug'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  if (!checkPermission(adminUser.permissions, 'categories', 'update', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid content type ID' })

  const db = getDb()
  const [existing] = await db.select().from(contentTypes).where(eq(contentTypes.id, id)).limit(1)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Thể loại không tồn tại.' })
  }

  const body = await readBody(event).catch(() => ({}))
  const updateFields: any = {}

  if (body.name !== undefined) updateFields.name = String(body.name).trim()
  if (body.icon !== undefined) updateFields.icon = String(body.icon).trim() || null
  if (body.description !== undefined) updateFields.description = String(body.description).trim() || null
  if (body.displayOrder !== undefined) updateFields.displayOrder = Number(body.displayOrder)

  // Slug change: only when an explicit slug is provided. System types keep a
  // fixed slug (backs public pages), so reject slug edits on them.
  let newSlug: string | null = null
  if (body.slug !== undefined && String(body.slug).trim()) {
    if (existing.isSystem) {
      throw createError({ statusCode: 400, statusMessage: 'Không thể đổi định danh (slug) của thể loại hệ thống.' })
    }
    const candidate = await uniqueContentTypeSlug(db, String(body.slug).trim(), id)
    if (candidate !== existing.slug) {
      newSlug = candidate
      updateFields.slug = candidate
    }
  }

  if (Object.keys(updateFields).length === 0) {
    return { ok: true, slug: existing.slug }
  }

  await db.update(contentTypes).set(updateFields).where(eq(contentTypes.id, id))

  // Cascade slug rename to referencing rows so categories/articles stay linked.
  if (newSlug) {
    await db.update(categories).set({ type: newSlug }).where(eq(categories.type, existing.slug))
    await db.update(articles).set({ type: newSlug }).where(eq(articles.type, existing.slug))
  }

  return { ok: true, slug: newSlug ?? existing.slug }
})
