import { requireResourcePermission } from '../../../utils/permissions'
import { purgePublicPageCacheAfterWrite } from '../../../utils/public-page-cache'
import { findPageById, pickUniquePageSlug } from '../../../services/admin-pages-queries'
import { updatePageWithAudit } from '../../../services/admin-page-write'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'pages', 'update')

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid page ID' })

  const existing = await findPageById(id)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Trang không tồn tại.' })
  }

  const body = await readBody(event).catch(() => ({}))
  // Kiểu tường minh thay cho `any`: `slug` đi vào giá trị trả về của handler, và
  // `Serialize` nuốt trường kiểu `any` nên trang gọi sẽ không thấy nó.
  const updateFields: Partial<{ title: string, slug: string, seoTitle: string | null, seoDescription: string | null, updatedBy: number }> = {}

  if (body.title !== undefined) {
    const title = String(body.title).trim()
    if (!title) throw createError({ statusCode: 400, statusMessage: 'Tiêu đề không được để trống.' })
    updateFields.title = title
  }
  if (body.seoTitle !== undefined) updateFields.seoTitle = String(body.seoTitle).trim() || null
  if (body.seoDescription !== undefined) updateFields.seoDescription = String(body.seoDescription).trim() || null

  // Slug is locked for system pages (home/about/contact). Custom pages may rename.
  if (body.slug !== undefined && !existing.isSystem) {
    const base = String(body.slug).trim() || existing.title
    updateFields.slug = await pickUniquePageSlug(base, id)
  }

  if (Object.keys(updateFields).length === 0) {
    return { ok: true, slug: existing.slug }
  }

  updateFields.updatedBy = adminUser.id
  // The update and its audit row commit together (services/admin-page-write.ts).
  await updatePageWithAudit(adminUser, id, updateFields)

  // Sau commit: tiêu đề/SEO của trang hệ thống (`/`, `/about`, `/contact`) nằm trong HTML
  // đã đệm `swr` (server/utils/public-page-cache.ts).
  await purgePublicPageCacheAfterWrite('pages.update')

  return { ok: true, slug: updateFields.slug ?? existing.slug }
})
