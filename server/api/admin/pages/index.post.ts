import { getDb } from '../../../utils/db'
import { pages, activityLogs } from '../../../db/schema'
import { checkPermission } from '../../../utils/auth'
import { uniquePageSlug } from '../../../utils/slug'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  if (!checkPermission(adminUser.permissions, 'pages', 'create', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }

  const body = await readBody(event).catch(() => ({}))
  const title = String(body?.title || '').trim()
  if (!title) {
    throw createError({ statusCode: 400, statusMessage: 'Tiêu đề trang là bắt buộc.' })
  }

  const db = getDb()
  const base = String(body?.slug || title).trim()
  const slug = await uniquePageSlug(db, base)

  const [res] = await db.insert(pages).values({
    slug,
    title,
    isSystem: false,
    seoTitle: body?.seoTitle ? String(body.seoTitle).trim() : null,
    seoDescription: body?.seoDescription ? String(body.seoDescription).trim() : null,
    updatedBy: adminUser.id,
  })

  const insertedId = (res as any).insertId

  await db.insert(activityLogs).values({
    userId: adminUser.id,
    action: 'create',
    resource: 'pages',
    meta: { slug, title },
  })

  return { ok: true, id: Number(insertedId), slug }
})
