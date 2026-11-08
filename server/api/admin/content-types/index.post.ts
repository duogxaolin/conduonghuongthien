import { requireResourcePermission } from '../../../utils/permissions'
import { autoTranslateContentType } from '../../../services/i18n-auto-translate'
import { purgePublicPageCacheAfterWrite } from '../../../utils/public-page-cache'
import { createContentTypeRow } from '../../../services/admin-taxonomy-queries'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'categories', 'create')

  const body = await readBody(event).catch(() => ({}))
  const name = String(body?.name || '').trim()
  const icon = String(body?.icon || '').trim() || null
  const description = (() => { const d = String(body?.description || '').trim(); return (!d || d.toLowerCase() === 'null') ? null : d })()
  const displayOrder = Number(body?.displayOrder ?? 0)

  if (!name) {
    throw createError({ statusCode: 400, statusMessage: 'Tên thể loại không được để trống.' })
  }

  // The service picks the clean, collision-safe slug from this (or from the name).
  const rawSlug = String(body?.slug || '').trim()
  const { id, slug: uniqueSlug } = await createContentTypeRow(rawSlug, { name, icon, description, displayOrder })

  // Non-blocking i18n auto-translate (vi gốc + AI dịch 5 lang).
  void autoTranslateContentType(adminUser, uniqueSlug, name, description).catch(() => {})

  // After the insert: content types feed the menus and lists of the cached public pages.
  await purgePublicPageCacheAfterWrite('content_types.create')

  return { ok: true, id, slug: uniqueSlug }
})
