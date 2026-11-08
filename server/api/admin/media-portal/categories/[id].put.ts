import type { mediaCategories } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'
import { findMediaCategoryById, mediaCategorySlugForUpdate, updateMediaCategoryRow } from '../../../../services/admin-media-categories'

/**
 * Sửa danh mục Media Portal. RBAC: `media_portal.update`.
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'media_portal', 'update')

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'ID danh mục không hợp lệ.' })

  const existing = await findMediaCategoryById(id)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Danh mục không tồn tại.' })
  }

  const body = await readBody(event).catch(() => ({}))
  const updateFields: Partial<typeof mediaCategories.$inferInsert> = {}

  if (body.name !== undefined) updateFields.name = String(body.name).trim()
  if (body.description !== undefined) updateFields.description = String(body.description).trim() || null
  if (body.displayOrder !== undefined) {
    const order = Number(body.displayOrder)
    updateFields.displayOrder = Number.isFinite(order) ? Math.floor(order) : 0
  }

  // Slug: regenerate/validate on name or slug change, excluding the current row.
  if (body.slug !== undefined || body.name !== undefined) {
    const rawSlug = body.slug !== undefined ? String(body.slug).trim() : ''
    const base = rawSlug || (updateFields.name as string | undefined) || existing.name
    updateFields.slug = await mediaCategorySlugForUpdate(base, id)
  }

  if (Object.keys(updateFields).length === 0) {
    return { ok: true, slug: existing.slug }
  }

  await updateMediaCategoryRow(id, updateFields)
  return { ok: true, slug: (updateFields.slug as string | undefined) ?? existing.slug }
})
