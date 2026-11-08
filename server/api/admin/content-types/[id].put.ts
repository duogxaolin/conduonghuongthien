import type { contentTypes } from '../../../db/schema'
import { bumpAnswerCacheVersion } from '../../../services/chatbot-answer-cache'
import { requireResourcePermission } from '../../../utils/permissions'
import { autoTranslateContentTypeUpdate } from '../../../services/i18n-auto-translate'
import { purgePublicPageCacheAfterWrite } from '../../../utils/public-page-cache'
import { contentTypeSlugForUpdate, findContentTypeById, updateContentTypeAndCascadeSlug } from '../../../services/admin-taxonomy-queries'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'categories', 'update')

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid content type ID' })

  const existing = await findContentTypeById(id)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Thể loại không tồn tại.' })
  }

  const body = await readBody(event).catch(() => ({}))
  const updateFields: Partial<typeof contentTypes.$inferInsert> = {}

  if (body.name !== undefined) updateFields.name = String(body.name).trim()
  if (body.icon !== undefined) updateFields.icon = String(body.icon).trim() || null
  if (body.description !== undefined) { const d = String(body.description).trim(); updateFields.description = (!d || d.toLowerCase() === 'null') ? null : d }
  if (body.displayOrder !== undefined) updateFields.displayOrder = Number(body.displayOrder)

  // Slug change: only when an explicit slug is provided. System types keep a
  // fixed slug (backs public pages), so reject slug edits on them.
  let newSlug: string | null = null
  if (body.slug !== undefined && String(body.slug).trim()) {
    if (existing.isSystem) {
      throw createError({ statusCode: 400, statusMessage: 'Không thể đổi định danh (slug) của thể loại hệ thống.' })
    }
    const candidate = await contentTypeSlugForUpdate(String(body.slug).trim(), id, !!existing.isSystem)
    if (candidate !== existing.slug) {
      newSlug = candidate
      updateFields.slug = candidate
    }
  }

  if (Object.keys(updateFields).length === 0) {
    return { ok: true, slug: existing.slug }
  }

  // The type, then (on a rename) its categories and articles — three UPDATEs, no transaction.
  await updateContentTypeAndCascadeSlug(id, updateFields, existing, newSlug)

  if (newSlug) {
    // Đổi slug thể loại đổi URL bài viết mà chatbot nạp sẵn vào câu trả lời; câu đã cache
    // còn trỏ địa chỉ cũ. Tăng phiên bản sau khi cả hai UPDATE đã chạy.
    await bumpAnswerCacheVersion().catch(() => undefined)
  }

  // Non-blocking i18n auto-translate update (re-upsert vi + re-dịch non-vi).
  const finalSlug = newSlug ?? existing.slug
  const finalName = (updateFields.name ?? existing.name) as string
  const finalDesc = (updateFields.description !== undefined ? updateFields.description : existing.description) as string | null
  if (updateFields.name !== undefined || updateFields.description !== undefined) {
    void autoTranslateContentTypeUpdate(adminUser, finalSlug, finalName, finalDesc).catch(() => {})
  }

  // After the writes (the slug rename cascades to categories and articles): cached public
  // pages list the type by name and link it by slug (server/utils/public-page-cache.ts).
  await purgePublicPageCacheAfterWrite('content_types.update')

  return { ok: true, slug: finalSlug }
})
