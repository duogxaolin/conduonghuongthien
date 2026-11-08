import { requireResourcePermission } from '../../../utils/permissions'
import { pickUniquePageSlug } from '../../../services/admin-pages-queries'
import { createPageWithAudit } from '../../../services/admin-page-write'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'pages', 'create')

  const body = await readBody(event).catch(() => ({}))
  const title = String(body?.title || '').trim()
  if (!title) {
    throw createError({ statusCode: 400, statusMessage: 'Tiêu đề trang là bắt buộc.' })
  }

  const base = String(body?.slug || title).trim()
  const slug = await pickUniquePageSlug(base)

  // The insert and its audit row commit together (services/admin-page-write.ts).
  const insertedId = await createPageWithAudit(adminUser, {
    slug,
    title,
    seoTitle: body?.seoTitle ? String(body.seoTitle).trim() : null,
    seoDescription: body?.seoDescription ? String(body.seoDescription).trim() : null,
  })

  return { ok: true, id: Number(insertedId), slug }
})
